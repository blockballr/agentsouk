import "server-only";

import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { erc8183Addresses } from "@altananetwork/sdk";
import { buildA2aParts, postRpc } from "@/lib/delivery";
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

// the a2a reply to negotiate: an envelope at result level (status quoted),
// not an artifact, so the delivery path's chunk reader does not apply here
export function parseNegotiationQuote(
  result: unknown,
  chainId: number,
  expectedProvider: string | null,
): NegotiationResult {
  const stack = erc8183Stack(chainId);
  if (!stack) return refuse(`the ERC-8183 stack is not deployed on chain ${chainId}`);
  const envelope = result as Record<string, unknown> | null;
  if (!envelope || typeof envelope !== "object") {
    return refuse("the negotiate reply is not an object");
  }
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
    return refuse("the quote is priced in a token the kernel does not escrow");
  }

  const providerAddress = typeof envelope.provider_address === "string" ? envelope.provider_address : "";
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
    quote: { price, currency, providerAddress, validUntil, negotiationHash, providerSig, agentId },
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
        parts: buildA2aParts(task),
      },
    },
  });
  if (send.status === 0) return refuse("the agent's endpoint did not answer the negotiate call");
  if (send.status === 402) return refuse("the agent gates the negotiate call behind its own payment, so it cannot be quoted through the marketplace");
  if (send.body.error) return refuse(`the negotiate call failed: ${String(send.body.error.message).slice(0, 200)}`);
  return parseNegotiationQuote((send.body as { result?: unknown }).result, chainId, expectedProvider);
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
    outputs: [
      { name: "id", type: "uint256" },
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "description", type: "string" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "hook", type: "address" },
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
  })) as readonly unknown[];
  const row = job as unknown as readonly unknown[];
  // the string body is in the tail, but readContract already decodes the tuple
  return {
    client: String(row[1]),
    provider: String(row[2]),
    evaluator: String(row[3]),
    description: String(row[4]),
    budget: row[5] as bigint,
    expiredAt: (row[6] as bigint),
    status: Number(row[7]),
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
        parts: [
          { kind: "data", data: { skill: "notify_funded", chain_id: chainId, ...payload } },
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

