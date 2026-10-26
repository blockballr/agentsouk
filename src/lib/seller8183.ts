import "server-only";

import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseUnits, stringToHex, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import {
  encodeErc8183Manifest,
  erc8183Addresses,
  erc8183ManifestHash,
  type Erc8183DeliverableManifest,
} from "@altananetwork/sdk";
import { loadDeliverable, saveDeliverable } from "@/lib/durable-store";
import { kernelJob, type KernelJobRead } from "@/lib/jobs8183";
import { privateEndpointReason } from "@/lib/endpoint";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";

// The seller half of ERC-8183, hung off the house agents' runtime. The
// marketplace already buys through the shared kernel (src/lib/jobs8183.ts
// prices the job and the buyer's wallet funds it); this lib makes the same
// runtime SELL through it. A negotiate data part comes back as a signed quote,
// a notify_funded data part is verified against the kernel's own row before
// any work runs, and the finished answer is submitted as a v1 deliverable
// manifest whose bytes this runtime then serves at a stable url, so the
// buyer's integrity check reads the same bytes the chain committed to.
//
// The seller identity is one env key, SELLER8183_PRIVATE_KEY, whose address
// must equal the listing's registered wallet: the kernel takes the submit call
// only from the job's provider, and the buyer's quote gate refuses a provider
// that is not the listing's registry wallet. Without the key configured the
// quote path answers unsigned with its reason rather than inventing one.

const COMMERCE_ABI = [
  {
    name: "submit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const RPC_URL: Record<number, string> = {
  97: "https://data-seed-prebsc-2-s2.binance.org:8545",
  56: "https://bsc-dataseed.bnbchain.org",
};

export function chainClient(chainId: number) {
  const transport = http(RPC_URL[chainId] ?? "https://bsc-dataseed.bnbchain.org");
  return createPublicClient({ chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport });
}

// Which seller-side data part this is, judged the way packages/core's
// job-seller judges a step of the protocol, so a card served here and a card
// sold there never drift apart.
const NEGOTIATE = /^negotiate(-erc8183-job)?$/i;
const NOTIFY = /^notify_funded$/i;

export function isNegotiateData(data: unknown): data is Record<string, unknown> & { skill: string } {
  const ok =
    typeof data === "object" && data !== null &&
    NEGOTIATE.test(String((data as Record<string, unknown>).skill ?? ""));
  return Boolean(ok);
}

export function isNotifyData(data: unknown): data is { skill: string; job_id: unknown } {
  const ok =
    typeof data === "object" && data !== null &&
    NOTIFY.test(String((data as Record<string, unknown>).skill ?? ""));
  return Boolean(ok);
}

// ---------------------------------------------------------------------------
// The negotiate step: a signed quote in the kernel's own payment token

export interface SellerConfig {
  chainId: number;
  /** The listing's registered wallet: the kernel's provider and the quote field. */
  providerWallet: string;
  /** 0x private key whose address must equal providerWallet. */
  sellerKey: string | undefined;
  /** Fallback price in whole payment-token units when the instruction names no capital. */
  priceUsd: number;
  /** Fee as a share of the traded capital, in basis points (50 = 0.5%). */
  feeBps: number;
  /** Floor on the fee, in whole payment-token units. */
  minFeeU: number;
  /** Ceiling on the fee, in whole payment-token units. */
  maxFeeU: number;
  /** The smallest capital the agent will quote, in USD. */
  minCapitalUsd: number;
  agentId: number | null;
  agentName: string;
}

export function sellerConfigFromEnv(
  chainId: number,
  agentId: number | null,
  agentName: string,
  suffix = "",
): SellerConfig {
  const providerWallet =
    chainId === BSC_TESTNET_CHAIN_ID
      ? process.env[`SELLER8183_PROVIDER_TESTNET${suffix}`] ?? process.env.SELLER8183_PROVIDER_TESTNET ?? process.env.SELLER8183_PROVIDER ?? ""
      : process.env[`SELLER8183_PROVIDER${suffix}`] ?? process.env.SELLER8183_PROVIDER ?? "";
  const sellerKeyRaw =
    chainId === BSC_TESTNET_CHAIN_ID
      ? process.env[`SELLER8183_PRIVATE_KEY_TESTNET${suffix}`] ?? process.env.SELLER8183_PRIVATE_KEY_TESTNET ?? process.env.SELLER8183_PRIVATE_KEY
      : process.env[`SELLER8183_PRIVATE_KEY${suffix}`] ?? process.env.SELLER8183_PRIVATE_KEY;
  // the paste sometimes drops the 0x lead, and every consumer between here and
  // the chain expects the prefixed form: normalize once, at config read
  const sellerKey = sellerKeyRaw && !sellerKeyRaw.startsWith("0x") ? `0x${sellerKeyRaw.trim()}` : sellerKeyRaw;
  // the price is RAW $U, not dollars: the token's own shape decides the
  // rate, so 1 U reads as ~$1 only inside the buyer's wallet's own display
  const price = Number(
    process.env[`SELLER8183_PRICE_U${suffix}`] ??
      process.env.SELLER8183_PRICE_U ??
      process.env[`SELLER8183_PRICE_USD${suffix}`] ??
      process.env.SELLER8183_PRICE_USD ??
      2,
  );
  const num = (name: string, fallback: number): number => {
    const raw = process.env[`${name}${suffix}`] ?? process.env[name];
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    chainId,
    providerWallet,
    sellerKey,
    priceUsd: Number.isFinite(price) && price > 0 ? price : 2,
    // a managed trade is priced as a share of the capital, with a floor that
    // covers gas and a cap that keeps a large instruction from a large fee
    feeBps: num("SELLER8183_FEE_BPS", 50),
    minFeeU: num("SELLER8183_MIN_FEE_U", 0.01),
    maxFeeU: num("SELLER8183_MAX_FEE_U", 0.05),
    minCapitalUsd: num("SELLER8183_MIN_CAPITAL_USD", 50),
    agentId,
    agentName,
  };
}

// The capital an instruction names, in USD. An explicit field wins; otherwise
// the text is read for "capital $500", "amount 500 USDT", "$500" or "500 U".
// A bare number is not enough: a grid instruction is full of prices and rungs.
export function capitalFromInstruction(data: Record<string, unknown>, task: string): number | null {
  for (const key of ["capital_usd", "capitalUsd", "amount_usd", "amountUsd", "capital", "amount"]) {
    const raw = data[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[$,]/g, "")) : Number.NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  const labelled = /(?:capital|amount|deposit|trade\s+with|budget)\s*(?:of|is|:|=)?\s*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(task);
  if (labelled) return Number(labelled[1].replace(/,/g, ""));
  const dollar = /\$\s*([\d,]+(?:\.\d+)?)/.exec(task);
  if (dollar) return Number(dollar[1].replace(/,/g, ""));
  const suffixed = /([\d,]+(?:\.\d+)?)\s*(?:usdt|usd|u)\b/i.exec(task);
  if (suffixed) return Number(suffixed[1].replace(/,/g, ""));
  return null;
}

// Round a fee to six decimals, which is well inside the token's 18 and keeps
// float noise out of the signed price.
function feeFor(cfg: SellerConfig, capitalUsd: number): number {
  const raw = (capitalUsd * cfg.feeBps) / 10_000;
  const clamped = Math.min(cfg.maxFeeU, Math.max(cfg.minFeeU, raw));
  return Math.round(clamped * 1e6) / 1e6;
}

// The materials the seller signs, one deterministic line, so a buyer can
// recompute the negotiation hash from the quote body alone.
export function negotiationMaterials(input: {
  task: string;
  terms: unknown;
  provider: string;
  currency: string;
  price: string;
  validUntil: number;
  agentId: number | null;
}): string {
  const parts = [
    "ERC8183-NEGOTIATE-v1",
    input.provider.toLowerCase(),
    input.currency.toLowerCase(),
    input.price,
    String(input.validUntil),
    input.task,
    input.agentId === null ? "" : String(input.agentId),
    input.terms ? JSON.stringify(input.terms) : "",
  ];
  return parts.join("\n");
}

export function negotiationHashOf(input: {
  task: string;
  terms: unknown;
  provider: string;
  currency: string;
  price: string;
  validUntil: number;
  agentId: number | null;
}): `0x${string}` {
  return keccak256(stringToHex(negotiationMaterials(input)));
}

export interface QuoteEnvelope {
  status: "quoted";
  price: string;
  currency: string;
  provider_address: string;
  valid_until: number;
  negotiation_hash: string;
  provider_sig: string;
  agent_id: number | null;
  // what the fee was computed from, for the buyer's own display; the kernel
  // only reads price, currency and provider
  capital_usd?: number | null;
  fee_usd?: number;
}

export type QuoteResult =
  | { ok: true; envelope: QuoteEnvelope }
  | { ok: false; status: "unsigned" | "refused"; unsigned_reason: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function quoteEnvelope(
  cfg: SellerConfig,
  negotiateData: Record<string, unknown>,
): Promise<QuoteResult> {
  let stack;
  try {
    stack = erc8183Addresses(cfg.chainId);
  } catch {
    return { ok: false, status: "refused", unsigned_reason: `the ERC-8183 kernel is not deployed on chain ${cfg.chainId}` };
  }
  if (!ADDRESS_RE.test(cfg.providerWallet)) {
    return { ok: false, status: "refused", unsigned_reason: "the seller has no registered wallet configured" };
  }
  const task = typeof negotiateData.task_description === "string" ? negotiateData.task_description.trim() : "";
  if (!task) {
    return { ok: false, status: "refused", unsigned_reason: "the negotiate step carries no task_description" };
  }
  if (!Number.isFinite(cfg.priceUsd) || cfg.priceUsd <= 0) {
    return { ok: false, status: "refused", unsigned_reason: "the seller's configured price is not a sane number" };
  }
  const terms = negotiateData.terms ?? null;
  // A managed trade is quoted as a fee on the capital the instruction names.
  // The capital itself goes to the vault, never here: this escrow is the fee.
  const capitalUsd = capitalFromInstruction(negotiateData, task);
  if (capitalUsd !== null && capitalUsd < cfg.minCapitalUsd) {
    return {
      ok: false,
      status: "refused",
      unsigned_reason: `the minimum trading capital is $${cfg.minCapitalUsd}; this instruction names $${capitalUsd}`,
    };
  }
  const quotedUsd = capitalUsd === null ? cfg.priceUsd : feeFor(cfg, capitalUsd);
  // a sub-unit price is legitimate: 0.01 U is a real quote. floor() would turn
  // it into zero, so the number is scaled in full instead.
  let price: string;
  try {
    // String() switches to exponent notation below 1e-6, which parseUnits does
    // not read; toFixed(18) keeps those prices in plain decimal form.
    const priceText = quotedUsd < 1e-6 ? quotedUsd.toFixed(18) : String(quotedUsd);
    price = parseUnits(priceText, 18).toString();
  } catch {
    return { ok: false, status: "refused", unsigned_reason: "the quoted fee has more than 18 decimals" };
  }
  const validUntil = Math.floor(Date.now() / 1000) + 1800;
  if (!cfg.sellerKey || !/^0x[0-9a-fA-F]{64}$/.test(cfg.sellerKey)) {
    return {
      ok: false,
      status: "unsigned",
      unsigned_reason: "the seller has no quote key configured, so it cannot sign a quote yet",
    };
  }
  const signer = privateKeyToAccount(cfg.sellerKey as `0x${string}`);
  if (signer.address.toLowerCase() !== cfg.providerWallet.toLowerCase()) {
    return {
      ok: false,
      status: "refused",
      unsigned_reason: `the quote key controls ${signer.address}, but this listing's registered wallet is ${cfg.providerWallet}`,
    };
  }
  const negotiationHash = negotiationHashOf({
    task,
    terms,
    provider: cfg.providerWallet,
    currency: stack.paymentToken,
    price,
    validUntil,
    agentId: cfg.agentId,
  });
  const providerSig = await signer.signMessage({ message: { raw: toBytes(negotiationHash) } });
  return {
    ok: true,
    envelope: {
      status: "quoted",
      price,
      currency: stack.paymentToken,
      provider_address: cfg.providerWallet,
      valid_until: validUntil,
      negotiation_hash: negotiationHash,
      provider_sig: providerSig,
      agent_id: cfg.agentId,
      capital_usd: capitalUsd,
      fee_usd: quotedUsd,
    },
  };
}

// ---------------------------------------------------------------------------
// The notify step: the kernel's own row is the only fact; the reply is acked
// only when the chain names us as the funded provider.

export type NotifyVerification =
  | { ok: true; jobId: bigint; description: string; budget: bigint }
  | { ok: false; reason: string };

export async function verifyNotify(
  cfg: SellerConfig,
  notifyData: { skill: string; job_id: unknown },
  readJob: (chainId: number, jobId: number) => Promise<Awaited<ReturnType<typeof kernelJob>>> = kernelJob,
): Promise<NotifyVerification> {
  const jobId = Number(notifyData.job_id);
  if (!Number.isSafeInteger(jobId) || jobId < 1) {
    return { ok: false, reason: "the notify_funded step carries no parseable job_id" };
  }
  if (!ADDRESS_RE.test(cfg.providerWallet)) {
    return { ok: false, reason: "the seller has no registered wallet configured" };
  }
  let job: KernelJobRead | null = null;
  try {
    job = await readJob(cfg.chainId, jobId);
  } catch {
    return { ok: false, reason: `the kernel would not read job ${jobId} on chain ${cfg.chainId}` };
  }
  if (!job) {
    return { ok: false, reason: `the kernel has no row for job ${jobId} on chain ${cfg.chainId}` };
  }
  if (String(job.provider).toLowerCase() !== cfg.providerWallet.toLowerCase()) {
    return {
      ok: false,
      reason: `kernel job ${jobId} names ${String(job.provider).slice(0, 10)} as its provider, not this listing's wallet`,
    };
  }
  // status 1 is Funded in the kernel's own enum order
  if (job.status !== 1) {
    return { ok: false, reason: `kernel job ${jobId} is not Funded (status ${job.status})` };
  }
  return { ok: true, jobId: BigInt(jobId), description: job.description, budget: job.budget };
}

// ---------------------------------------------------------------------------
// The work step: the agent decides the task its job describes, and the answer
// becomes the deliverable. Each host passes its own decide function, so the
// same runtime that answers a direct task answers a funded job.

export type SellerWork = (task: string) => { text: string } | Promise<{ text: string }>;

export function deliverableManifest(jobId: bigint, chainId: number, answer: {
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
}): { manifest: Erc8183DeliverableManifest; manifestText: string; deliverable: `0x${string}`; optParams: `0x${string}`; deliverableUrl: string } {
  const stack = erc8183Addresses(chainId);
  const origin = chainId === BSC_TESTNET_CHAIN_ID
    ? process.env.SELLER8183_PUBLIC_ORIGIN_TESTNET ?? "https://api.agentsouk.xyz"
    : process.env.SELLER8183_PUBLIC_ORIGIN ?? "https://api.agentsouk.xyz";
  // The manifest must be served verbatim; the route under /api/house-agent
  // deliverable serves exactly these bytes, so the url is derived, not asked.
  const deliverableUrl = `${origin.replace(/\/+$/, "")}/api/house-agent/deliverable/${jobId.toString()}`;
  const manifest: Erc8183DeliverableManifest = {
    version: 1,
    job_id: Number(jobId),
    chain_id: chainId,
    contracts: { commerce: stack.commerce, router: stack.router, policy: stack.policy },
    response: { content: answer.content, content_type: answer.contentType },
    metadata: answer.metadata,
  };
  const manifestText = encodeErc8183Manifest(manifest);
  return {
    manifest,
    manifestText,
    deliverable: erc8183ManifestHash(manifest),
    optParams: stringToHex(JSON.stringify({ deliverable_url: deliverableUrl })),
    deliverableUrl,
  };
}

// ---------------------------------------------------------------------------
// The submit step: the kernel takes submit only from the job's provider, so
// the seller key signs a raw transaction itself; it pays its own gas on that
// chain. On success the manifest text is stashed under the job id for the
// serving route to return verbatim.

export type SubmitResult =
  | { ok: true; txHash: string; deliverableUrl: string }
  | { ok: false; reason: string };

export interface ManifestStore {
  save(jobId: string, manifestText: string): Promise<void> | void;
  get(jobId: string): Promise<string | null> | string | null;
}

// Because a cold start or another instance may serve the deliverable, the
// manifest must outlive the process, so the postgres is the primary; the
// in-process map only holds a write-through copy for hot reads.
const memoryManifests = new Map<string, string>();

export const manifestStore: ManifestStore = {
  async save(jobId: string, manifestText: string): Promise<void> {
    memoryManifests.set(jobId, manifestText);
    await saveDeliverable(jobId, manifestText);
  },
  async get(jobId: string): Promise<string | null> {
    const hot = memoryManifests.get(jobId);
    if (hot !== undefined) return hot;
    const durable = await loadDeliverable(jobId);
    if (durable) memoryManifests.set(jobId, durable);
    return durable ?? null;
  },
};

const SUBMIT_GAS_FALLBACK = 120000n;

export async function submitDeliverable(
  cfg: SellerConfig,
  jobId: bigint,
  answer: { content: string; contentType: string; metadata: Record<string, unknown> },
): Promise<SubmitResult> {
  if (!cfg.sellerKey || !/^0x[0-9a-fA-F]{64}$/.test(cfg.sellerKey)) {
    return { ok: false, reason: "the seller has no key configured, so it cannot submit a deliverable" };
  }
  const signer = privateKeyToAccount(cfg.sellerKey as `0x${string}`);
  if (signer.address.toLowerCase() !== cfg.providerWallet.toLowerCase()) {
    return { ok: false, reason: `the submit key controls ${signer.address}, not this listing's wallet` };
  }
  let stack;
  try {
    stack = erc8183Addresses(cfg.chainId);
  } catch {
    return { ok: false, reason: `the ERC-8183 kernel is not deployed on chain ${cfg.chainId}` };
  }
  const built = deliverableManifest(jobId, cfg.chainId, answer);
  const publicClient = chainClient(cfg.chainId);
  const wallet = createWalletClient({ account: signer, chain: cfg.chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: http(RPC_URL[cfg.chainId]) });
  const txHash = await wallet.sendTransaction({
    to: stack.commerce as `0x${string}`,
    data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "submit", args: [jobId, built.deliverable, built.optParams] }),
    gas: SUBMIT_GAS_FALLBACK,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    return { ok: false, reason: `the submit transaction ${txHash} reverted` };
  }
  await manifestStore.save(jobId.toString(), built.manifestText);
  return { ok: true, txHash: txHash, deliverableUrl: built.deliverableUrl };
}

// The serving route reads through the same store, so a buyer's verification
// fetches exactly the bytes the chain committed to, on this instance or any
// other.
export async function serveableManifestText(jobId: string): Promise<string | null> {
  return manifestStore.get(jobId);
}

// ---------------------------------------------------------------------------
// One entry point for an a2a route: judge the incoming parts, answer the two
// protocol steps, and report when neither was addressed, so every host keeps
// its own decide path untouched.

export interface SellerHookResult {
  /** the a2a result body to reply with when handled, null to fall through */
  kind: "quote" | "ack" | "unsigned" | "refused" | "none";
  envelope: Record<string, unknown> | null;
}

export async function sellerHook(
  cfg: SellerConfig,
  parts: unknown[],
  work: SellerWork,
  readJob: (chainId: number, jobId: number) => Promise<Awaited<ReturnType<typeof kernelJob>>> = kernelJob,
  submit: (cfg: SellerConfig, jobId: bigint, answer: { content: string; contentType: string; metadata: Record<string, unknown> }) => Promise<SubmitResult> = submitDeliverable,
): Promise<SellerHookResult> {
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== "object") continue;
    const data = (part as { data?: unknown }).data;
    if (!data || typeof data !== "object") continue;
    if (isNegotiateData(data)) {
      const q = await quoteEnvelope(cfg, data);
      if (q.ok) return { kind: "quote", envelope: q.envelope as unknown as Record<string, unknown> };
      return { kind: q.status, envelope: { status: q.status, unsigned_reason: q.unsigned_reason } };
    }
    if (isNotifyData(data)) {
      const v = await verifyNotify(cfg, data, readJob);
      if (!v.ok) return { kind: "refused", envelope: { status: "refused", unsigned_reason: v.reason } };
      const answer = await Promise.resolve(work(v.description));
      const submitted = await submit(
        cfg,
        v.jobId,
        { content: answer.text, contentType: "text/plain", metadata: { agent: cfg.agentName } },
      );
      if (!submitted.ok) {
        return { kind: "refused", envelope: { status: "refused", unsigned_reason: `the deliverable was not submitted: ${submitted.reason}` } };
      }
      return {
        kind: "ack",
        envelope: {
          status: "acknowledged",
          job_id: v.jobId.toString(),
          submit_tx: submitted.txHash,
          deliverable_url: submitted.deliverableUrl,
        },
      };
    }
  }
  return { kind: "none", envelope: null };
}

// the private-endpoint rules mirror the delivery path's: a house seller is a
// public endpoint by construction, so this only guards the quote path's card
// handshake over at src/lib/jobs8183.ts
export function sellerEndpointBlocked(url: string): string | null {
  return privateEndpointReason(url);
}
