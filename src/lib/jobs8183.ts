import "server-only";

import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { BNB, BNB_TESTNET, erc8183Addresses, getErc8183DeliverableUrl } from "@altananetwork/sdk";
import { buildA2aParts, postRpc } from "@/lib/delivery";
import { loadDeliverable } from "@/lib/durable-store";
import { privateEndpointReason } from "@/lib/endpoint";
import { rpcTransport } from "@/lib/rpc";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";

// The negotiate step of the ERC-8183 buy flow. The seller's own a2a endpoint
// answers a task with a signed quote; the marketplace turns that into the
// resolved fields the fund step will approve against, refusing anything the
// shared kernel cannot actually honor.

export interface NegotiationQuote {
  price: bigint;
  currency: string;
  providerAddress: string;
  validUntil: number;
  negotiationHash: string;
  providerSig: string;
  // the seller's whole signed envelope, verbatim. a rebuilt subset loses the
  // request hash the seller verifies, so the on-chain description carries this.
  envelope: Record<string, unknown>;
  agentId: string | null;
}

export type NegotiationResult =
  | { ok: true; quote: NegotiationQuote }
  | { ok: false; error: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]+$/;
const PRICE_CEILING = 10n ** 24n;

function refuse(error: string): NegotiationResult {
  return { ok: false, error };
}

// the kernel's stack per chain: read, never hardcoded here
export function erc8183Stack(chainId: number): {
  commerce: string;
  router: string;
  policy: string;
  paymentToken: string;
} | null {
  try {
    const addresses = erc8183Addresses(chainId);
    return {
      commerce: addresses.commerce,
      router: addresses.router,
      policy: addresses.policy,
      paymentToken: addresses.paymentToken,
    };
  } catch {
    return null;
  }
}

// a seller answers the negotiate step in one of two shapes, and the nested one is
// flattened to the flat envelope's keys so neither of them can skip a check
function quoteEnvelope(
  result: unknown,
): { fields: Record<string, unknown>; raw: Record<string, unknown> } | null {
  const r = result as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const parts = Array.isArray(r.parts) ? r.parts : [];
  for (const part of parts) {
    const data = (part as { data?: unknown } | null)?.data;
    if (!data || typeof data !== "object") continue;
    const d = data as Record<string, unknown>;
    const response = (d.response ?? {}) as Record<string, unknown>;
    const terms = (response.terms ?? {}) as Record<string, unknown>;
    // an explicit accepted flag travels as quoted, so a refusal reaches its reason
    const accepted = response.accepted;
    return {
      // the seller signed this exact object; the anchor must carry it without
      // the flattened convenience fields added below
      raw: { ...d },
      fields: {
        ...d,
        status: accepted === undefined ? (d.status as string | undefined) : "quoted",
        accepted,
        price: terms.price ?? d.price,
        currency: terms.currency ?? d.currency,
        provider_address: d.provider_address ?? response.provider_address,
        unsigned_reason: d.unsigned_reason ?? response.unsigned_reason,
        valid_until: response.quote_expires_at ?? d.valid_until,
      },
    };
  }
  return { fields: r, raw: r };
}

export function parseNegotiationQuote(
  result: unknown,
  chainId: number,
  expectedProvider: string | null,
): NegotiationResult {
  const stack = erc8183Stack(chainId);
  if (!stack) return refuse(`the ERC-8183 stack is not deployed on chain ${chainId}`);
  const parsed = quoteEnvelope(result);
  if (!parsed) {
    return refuse("the negotiate reply is not an object");
  }
  const envelope = parsed.fields;
  const status = envelope.status;
  if (status !== "quoted") {
    const reason = typeof envelope.unsigned_reason === "string" ? `: ${envelope.unsigned_reason.slice(0, 200)}` : "";
    return refuse(`the agent replied "${String(status ?? "nothing").slice(0, 40)}" instead of a quote${reason}`);
  }
  if (envelope.accepted === false) {
    const reason = typeof envelope.unsigned_reason === "string" ? envelope.unsigned_reason.slice(0, 200) : "no reason given";
    return refuse(`the agent refused the negotiation: ${reason}`);
  }

  const priceRaw = envelope.price;
  if (typeof priceRaw !== "string" && typeof priceRaw !== "number") {
    return refuse("the quote carries no price");
  }
  let price: bigint;
  try {
    price = BigInt(priceRaw);
  } catch {
    return refuse("the quoted price is not a token amount");
  }
  if (price <= 0n || price >= PRICE_CEILING) {
    return refuse("the quoted price is not a sane token amount");
  }

  const currency = typeof envelope.currency === "string" ? envelope.currency : "";
  if (!ADDRESS_RE.test(currency)) return refuse("the quote names no payment token");
  if (currency.toLowerCase() !== stack.paymentToken.toLowerCase()) {
    return refuse(
      `the quote is priced in ${currency}, but this kernel escrows ${stack.paymentToken}; the agent's negotiate reply must price in the kernel's token`,
    );
  }

  // a seller that omits the provider pays the listing's own registry wallet
  const providerAddress =
    typeof envelope.provider_address === "string" && envelope.provider_address
      ? envelope.provider_address
      : expectedProvider ?? "";
  if (!ADDRESS_RE.test(providerAddress)) return refuse("the quote names no provider wallet");
  if (expectedProvider && ADDRESS_RE.test(expectedProvider) && providerAddress.toLowerCase() !== expectedProvider.toLowerCase()) {
    return refuse("the quote names a provider that is not this listing's registry wallet");
  }

  const validUntil = typeof envelope.valid_until === "number" ? envelope.valid_until : Number(envelope.valid_until);
  if (!Number.isSafeInteger(validUntil) || validUntil <= Math.floor(Date.now() / 1000) + 30) {
    return refuse("the quote has already expired");
  }

  const negotiationHash = typeof envelope.negotiation_hash === "string" ? envelope.negotiation_hash : "";
  const providerSig = typeof envelope.provider_sig === "string" ? envelope.provider_sig : "";
  if (!HEX_RE.test(negotiationHash) || !HEX_RE.test(providerSig)) {
    return refuse("the quote is missing its negotiation hash or the provider's signature");
  }

  const agentId = envelope.agent_id === undefined ? null : String(envelope.agent_id);
  return {
    ok: true,
    quote: { price, currency, providerAddress, validUntil, negotiationHash, providerSig, agentId, envelope: parsed.raw },
  };
}

// dial the seller with the task and return the validated quote. The endpoint
// rules match the delivery path's: a private address is refused before any
// byte leaves, at both the registry record and the card's own messaging url
export async function negotiateQuote(
  chainId: number,
  endpoint: string,
  task: string,
  expectedProvider: string | null,
): Promise<NegotiationResult> {
  if (!endpoint) return refuse("the listing carries no a2a endpoint to negotiate on");
  const blocked = privateEndpointReason(endpoint);
  if (blocked) return refuse(`${blocked}; the owner needs to publish a public messaging url for the negotiate step`);
  let messagingUrl = endpoint;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const cardRes = await fetch(endpoint, { headers: { accept: "application/json" }, signal: ctl.signal }).finally(() =>
      clearTimeout(timer),
    );
    const card = (await cardRes.json()) as { url?: string; supportedInterfaces?: { url?: string }[] };
    const fromCard = card.supportedInterfaces?.[0]?.url ?? card.url;
    if (fromCard) messagingUrl = fromCard;
  } catch {
    // not a card; the registered endpoint is the messaging url
  }
  const cardBlocked = privateEndpointReason(messagingUrl);
  if (cardBlocked) return refuse(`${cardBlocked}; the card names it as the messaging url, so the owner needs a public one`);

  const send = await postRpc(messagingUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        messageId: `agora-${Date.now()}`,
        // the shaped form the ERC-8183 sellers document on their cards rides
        // beside the human-readable task, so a skill-routing seller quotes
        // without guessing and a text-reading one still sees the words
        parts: [
          ...buildA2aParts(task),
          {
            kind: "data",
            data: {
              skill: "negotiate",
              task_description: task,
              terms: {
                deliverables: "the task's answer as the job's deliverable",
                quality_standards: "the deliverable matches the task's ask",
                success_criteria: "uomp_notify_context_required_v1",
              },
            },
          },
        ],
      },
    },
  });
  if (send.status === 0) return refuse("the agent's endpoint did not answer the negotiate call");
  if (send.status === 402) return refuse("the agent gates the negotiate call behind its own payment, so it cannot be quoted through the marketplace");
  if (send.body.error) return refuse(`the negotiate call failed: ${String(send.body.error.message).slice(0, 200)}`);
  const result = (send.body as { result?: unknown }).result;
  if (result === undefined || result === null) {
    // a gated or off-protocol seller answers in its own words, and those words
    // are the only diagnosis its owner and a buyer can act on, so they ride the
    // refusal instead of an internal parse complaint
    const raw = JSON.stringify(send.body) ?? "";
    return refuse(`the agent's reply carried no quote: ${raw.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return parseNegotiationQuote(result, chainId, expectedProvider);
}

// the kernel's job row, read fresh: the fund step and the notify step both
// verify against what the chain actually says, so a stale or forged claim can
// never stand in for a job that was never funded
export interface KernelJobView {
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: number;
  status: number;
}

const KERNEL_JOB_ABI = [
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    // the kernel returns the job as one struct, so its abi answer is an outer
    // offset word followed by the nine fields; declaring the nine flat made
    // every decode read the evaluator address as the description's offset and
    // throw, which 500'd the record route and left the seller unnotified
    outputs: [
      {
        name: "job",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export interface KernelJobRead {
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  submittedAt: bigint;
  deliverable: string;
}

export async function kernelJob(
  chainId: number,
  onchainJobId: number,
): Promise<KernelJobRead | null> {
  const stack = erc8183Stack(chainId);
  if (!stack) return null;
  const client = createPublicClient({ chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: rpcTransport(chainId) });
  const job = (await client.readContract({
    address: stack.commerce as `0x${string}`,
    abi: KERNEL_JOB_ABI,
    functionName: "getJob",
    args: [BigInt(onchainJobId)],
  })) as unknown as {
    id: bigint;
    client: string;
    provider: string;
    evaluator: string;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: string;
    submittedAt: bigint;
    deliverable: string;
  };
  return {
    client: String(job.client),
    provider: String(job.provider),
    evaluator: String(job.evaluator),
    description: String(job.description),
    budget: job.budget,
    expiredAt: job.expiredAt,
    status: Number(job.status),
    submittedAt: job.submittedAt ?? 0n,
    deliverable: String(job.deliverable ?? "0x"),
  };
}

// The seller's result, once the kernel says it was submitted. The house agents
// keep their manifest in the durable deliverable store; an external seller's
// manifest is located through the policy's JobInitialised event and fetched
// from the url it committed to. The UI gets text, not a promise that one exists.
export interface KernelJobResult {
  content: string | null;
  contentType: string | null;
  url: string | null;
}

const RESULT_MAX_CHARS = 50_000;

function parseDeliverableManifest(text: string): { content: string; contentType: string } | null {
  try {
    const parsed = JSON.parse(text) as {
      response?: { content?: unknown; content_type?: unknown };
    };
    if (typeof parsed.response?.content === "string") {
      return {
        content: parsed.response.content.slice(0, RESULT_MAX_CHARS),
        contentType: typeof parsed.response.content_type === "string" ? parsed.response.content_type : "text/plain",
      };
    }
  } catch {
    // a third-party seller may serve plain text; that is still the result
  }
  const trimmed = text.trim();
  return trimmed ? { content: trimmed.slice(0, RESULT_MAX_CHARS), contentType: "text/plain" } : null;
}

async function fetchDeliverableText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/plain, application/json" },
    });
    if (!res.ok) return null;
    const finalUrl = res.url || url;
    if (privateEndpointReason(finalUrl)) return null;
    const text = await res.text();
    return text.slice(0, RESULT_MAX_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function kernelJobResult(
  chainId: number,
  onchainJobId: number,
  job: KernelJobRead,
): Promise<KernelJobResult | null> {
  if (job.status < 2 || job.submittedAt <= 0n) return null;
  const local = await loadDeliverable(String(onchainJobId)).catch(() => undefined);
  let raw = local ?? null;
  let url: string | null = null;
  if (!raw) {
    const network = chainId === BSC_TESTNET_CHAIN_ID ? BNB_TESTNET : BNB;
    url = (await getErc8183DeliverableUrl(network, BigInt(onchainJobId), {
      scanWindow: 1_000n,
      maxWindows: 80,
    }).catch(() => undefined)) ?? null;
    if (url) {
      const blocked = privateEndpointReason(url);
      if (!blocked) raw = await fetchDeliverableText(url);
    }
  }
  if (!raw && !url) return null;
  const parsed = raw ? parseDeliverableManifest(raw) : null;
  return {
    content: parsed?.content ?? null,
    contentType: parsed?.contentType ?? null,
    url,
  };
}

// The protocol's notify step, best effort: the seller's card declares the
// notify_funded skill, so every funded job hands the seller the id, the chain
// and the proof it anchored. Most testnet sellers answer with a fresh quote
// (their runtimes route every message to negotiate), so the reply is recorded
// as evidence while the chain stays the only source of truth on the record.
export interface SellerNotifyResult {
  ok: boolean;
  reply: string;
}

export async function notifySeller(
  chainId: number,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<SellerNotifyResult> {
  if (!endpoint) return { ok: false, reply: "the listing carries no a2a endpoint to notify" };
  const blocked = privateEndpointReason(endpoint);
  if (blocked) return { ok: false, reply: `${blocked}; the owner needs to publish a messaging url` };
  let messagingUrl = endpoint;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const cardRes = await fetch(endpoint, { headers: { accept: "application/json" }, signal: ctl.signal }).finally(() =>
      clearTimeout(timer),
    );
    const card = (await cardRes.json()) as { url?: string; supportedInterfaces?: { url?: string }[] };
    const fromCard = card.supportedInterfaces?.[0]?.url ?? card.url;
    if (fromCard) messagingUrl = fromCard;
  } catch {
    // not a card; the registered endpoint is the messaging url
  }
  const send = await postRpc(messagingUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        messageId: `agora-notify-${Date.now()}`,
        // the canonical shape the seller cards document: skill and job id,
        // nothing else, because the seller reads the funded job's own row on
        // chain for everything more
        parts: [
          { kind: "data", data: { skill: "notify_funded", job_id: payload.job_id } },
          { kind: "text", text: `notify_funded: job ${String(payload.job_id)} is funded on chain ${chainId}; the price sits in the kernel's escrow.` },
        ],
      },
    },
  });
  if (send.status === 0) return { ok: false, reply: "the seller's endpoint did not answer" };
  const result = send.body as { result?: unknown; error?: { message?: string } };
  const reply = result.result === undefined
    ? `error: ${String(result.error?.message ?? "no reply").slice(0, 200)}`
    : JSON.stringify(result.result).slice(0, 300);
  // an answer whose shape is a fresh quote rather than an ack is today's usual
  // testnet seller behavior; the ack itself carries no on-chain meaning
  const acknowledged = typeof (result.result as { status?: unknown })?.status === "string"
    ? !["quoted", "refused", "not_quoted"].includes(String((result.result as { status?: unknown }).status))
    : true;
  return { ok: acknowledged, reply };
}

