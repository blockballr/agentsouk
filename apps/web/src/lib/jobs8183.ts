// The buyer half of an ERC-8183 hire on the shared kernel: five signed calls
// (createJob, registerJob, setBudget, approve $U, fund), encoded here with
// plain viem so the browser bundle carries no SDK, and pinned byte-for-byte
// against the SDK's own builder in the tests, because a drifting encoding
// would fund against the wrong job.
import { encodeFunctionData } from "viem"

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

// the job description anchors the signed quote the buyer is funding against:
// the task for the seller to read, then the quote's proof verbatim. The
// kernel caps the field at 4096 bytes, so an over-long task is cut and the
// proof never is
export function jobDescription(task: string, quote: NegotiationQuoteView): string {
  const proof = JSON.stringify({
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
