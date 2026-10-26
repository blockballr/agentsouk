// The buyer half of an ERC-8183 hire on the shared kernel: five signed calls
// (createJob, registerJob, setBudget, approve $U, fund), encoded here with
// plain viem so the browser bundle carries no SDK, and pinned byte-for-byte
// against the SDK's own builder in the tests, because a drifting encoding
// would fund against the wrong job.
import { encodeFunctionData, getAddress } from "viem"

export interface Jobs8183Stack {
  commerce: string
  router: string
  policy: string
  paymentToken: string
}

export interface NegotiationQuoteView {
  price: string
  currency: string
  providerAddress: string
  validUntil: number
  negotiationHash: string
  providerSig: string
  agentId: string | null
  /** the seller's signed envelope, verbatim, for the on-chain anchor */
  envelope?: Record<string, unknown>
}

const COMMERCE_ABI = [
  { name: "createJob", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "string" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "setBudget", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "getJob", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "address" }] },
  { name: "jobCounter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const

const ROUTER_ABI = [
  { name: "registerJob", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
] as const

const POLICY_ABI = [
  { name: "disputeWindow", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const

const TOKEN_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const

// The stock-analyst family of sellers verifies a canonical quote envelope:
// sorted keys, response terms, and the notify-context marker. A rebuilt subset
// or the raw negotiate reply fails its check, so mirror that builder exactly.
export const NOTIFY_CONTEXT_REQUIRED = "uomp_notify_context_required_v1"

function sanitizeQuoteText(s: string): string {
  return s.replace(/\[/g, "(").replace(/\]/g, ")").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
}

function sortQuoteKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v
  const obj = v as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) sorted[k] = sortQuoteKeys(obj[k])
  return sorted
}

function canonicalAnchor(anchor: Record<string, unknown>, task: string): string {
  const request = (anchor.request ?? {}) as Record<string, unknown>
  const response = (anchor.response ?? {}) as Record<string, unknown>
  const agreed = (response.terms ?? {}) as Record<string, unknown>
  const terms: Record<string, unknown> = {
    deliverables: sanitizeQuoteText(String(agreed.deliverables ?? "")),
    quality_standards: sanitizeQuoteText(String(agreed.quality_standards ?? "")),
  }
  // the seller only signs this key when it is present; an empty one changes the hash
  const criteria = agreed.success_criteria
  if (criteria) {
    terms.success_criteria = Array.isArray(criteria)
      ? criteria.map((c) => sanitizeQuoteText(String(c)))
      : [sanitizeQuoteText(String(criteria))]
  }
  const content: Record<string, unknown> = {
    version: 1,
    negotiated_at: response.negotiated_at ?? anchor.negotiated_at ?? Math.floor(Date.now() / 1000),
    task: sanitizeQuoteText(String(request.task_description ?? task)),
    terms,
    price: agreed.price,
    currency: agreed.currency,
  }
  if (response.quote_expires_at != null) content.quote_expires_at = response.quote_expires_at
  if (anchor.chain_id != null) content.chain_id = anchor.chain_id
  if (anchor.verifying_contract) {
    content.verifying_contract = getAddress(String(anchor.verifying_contract))
  }
  content.negotiation_hash = anchor.negotiation_hash ?? response.negotiation_hash ?? ""
  content.provider_sig = anchor.provider_sig ?? response.provider_sig ?? ""
  return JSON.stringify(sortQuoteKeys(content))
}

// the job description anchors the signed quote the buyer is funding against:
// the task for the seller to read, then the quote's proof verbatim. The
// kernel caps the field at 4096 bytes, so an over-long task is cut and the
// proof never is
export function jobDescription(task: string, quote: NegotiationQuoteView): string {
  const anchor = quote.envelope
  if (anchor && anchor.request_hash && anchor.response_hash) {
    return canonicalAnchor(anchor, task)
  }
  const proof = anchor
    ? JSON.stringify(anchor)
    : JSON.stringify({
        status: "quoted",
        price: quote.price,
        currency: quote.currency,
        provider_address: quote.providerAddress,
        valid_until: quote.validUntil,
        negotiation_hash: quote.negotiationHash,
        provider_sig: quote.providerSig,
      })
  const budget = 4096 - new TextEncoder().encode(proof).length - 20
  const taskBytes = new TextEncoder().encode(task).length
  return taskBytes <= budget ? `${task}\n\nsigned quote: ${proof}` : `${task.slice(0, Math.max(0, budget - 24))}\n[task cut to fit]\n\nsigned quote: ${proof}`
}

export interface JobCallInput {
  jobId: bigint
  provider: string
  expiredAt: bigint
  budgetRaw: bigint
  description: string
}

export function encodeJobCalls(stack: Jobs8183Stack, input: JobCallInput): { to: string; data: string; label: string }[] {
  return [
    {
      to: stack.commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "createJob", args: [input.provider as `0x${string}`, stack.router as `0x${string}`, input.expiredAt, input.description, stack.router as `0x${string}`] }),
      label: "create the job",
    },
    {
      to: stack.router,
      data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "registerJob", args: [input.jobId, stack.policy as `0x${string}`] }),
      label: "bind the dispute policy",
    },
    {
      to: stack.commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "setBudget", args: [input.jobId, input.budgetRaw, "0x"] }),
      label: "set the agreed price",
    },
    {
      to: stack.paymentToken,
      data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [stack.commerce as `0x${string}`, input.budgetRaw] }),
      label: "approve the kernel to escrow the price",
    },
    {
      to: stack.commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "fund", args: [input.jobId, input.budgetRaw, "0x"] }),
      label: "lock the price into escrow",
    },
  ]
}

export function encodeJobCounter(): string {
  return encodeFunctionData({ abi: COMMERCE_ABI, functionName: "jobCounter", args: [] })
}

export function encodeDisputeWindow(): string {
  return encodeFunctionData({ abi: POLICY_ABI, functionName: "disputeWindow", args: [] })
}

export function encodeBalanceOf(wallet: string): string {
  return encodeFunctionData({ abi: TOKEN_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] })
}

export function encodeGetJob(jobId: bigint): string {
  return encodeFunctionData({ abi: COMMERCE_ABI, functionName: "getJob", args: [jobId] })
}

const JOB_STATUS_NAMES = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const

export function jobStatusName(status: number): string {
  return JOB_STATUS_NAMES[status] ?? "Unknown"
}

// ---------------------------------------------------------------------------
// Bundled funding (EIP-5792): one wallet approval for the whole ERC-8183
// fund sequence, instead of five separate popups. Wallets that do not speak
// wallet_sendCalls (or that report no batch capability) return
// { supported: false } and the caller falls back to the sequential flow.
export type BundledFundResult =
  | { supported: false }
  | { supported: true; ok: true }
  | { supported: true; ok: false; error: string };

export async function tryBundledFund(
  provider: Eip1193Like,
  chainId: number,
  account: string,
  calls: { to: string; data: string; label: string }[],
): Promise<BundledFundResult> {
  // attempt the batch; a "method not found" answer means unsupported. We do not
  // gate on wallet_getCapabilities because some wallets skip it entirely.
  let batchId: string;
  try {
    const res = (await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: `0x${chainId.toString(16)}`,
          from: account,
          calls: calls.map((c) => ({ to: c.to, data: c.data })),
        },
      ],
    })) as { id?: string } | null;
    if (!res || typeof res.id !== "string") throw new Error("no batch id returned");
    batchId = res.id;
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (/not (found|supported)|method not found|unsupported|unrecognized/i.test(msg)) {
      return { supported: false };
    }
    return { supported: true, ok: false, error: msg || "bundled fund failed" };
  }

  // poll for completion
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    let status: { status?: string } | null = null;
    try {
      status = (await provider.request({
        method: "wallet_getCallsStatus",
        params: [batchId],
      })) as { status?: string } | null;
    } catch {
      continue;
    }
    const s = (status?.status ?? "").toLowerCase();
    if (s === "confirmed" || s === "success" || s === "completed") {
      return { supported: true, ok: true };
    }
    if (s === "failed" || s === "reverted" || s === "rejected") {
      return { supported: true, ok: false, error: `bundled fund ${s}` };
    }
  }
  return { supported: true, ok: false, error: "bundled fund timed out waiting for confirmation" };
}

// getJob's return is an outer offset word followed by the 9-field tuple, and
// the tuple's string field is an inner offset, so the outer word is sliced
// and the static fields read forward: client at one, provider at two,
// budget at five, status at seven
export function decodeGetJob(raw: string): { provider: string; budget: bigint; status: number } | null {
  if (raw === "0x" || raw.length < 2 + 64 * 10) return null
  const words = raw.slice(2 + 64).match(/.{64}/g) ?? []
  if (words.length < 9) return null
  const at = (i: number): bigint => BigInt(`0x${words[i]}`)
  if (at(0) === 0n) return null
  return {
    provider: `0x${words[2].slice(24)}`,
    budget: at(5),
    status: Number(at(7)),
  }
}

export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

export function uintFromWord(data: string): bigint {
  return data === "0x" || data.length < 3 ? 0n : BigInt(data)
}
