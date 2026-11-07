import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { CliError } from "../core/errors";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";
import { quoteJob, type QuoteResult } from "./jobs";

// The buyer's side of an ERC-8183 job: quote, then create, bind the policy, set
// the agreed budget, approve the payment token and fund. The CLI splits prepare
// from fund so the price and the gas are seen before anything is signed.

const COMMERCE_ABI = [
  { name: "createJob", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "string" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "setBudget", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "bytes" }], outputs: [] },
  { name: "jobCounter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
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

const ROUTER_ABI = [
  { name: "registerJob", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
] as const;

const POLICY_ABI = [{ name: "disputeWindow", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }] as const;
const TOKEN_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export interface HirePlan {
  chainId: number;
  tokenId: string;
  agent: string;
  description: string;
  price: bigint;
  feeUsd: number | null;
  currency: string;
  provider: string;
  jobId: bigint;
  expiredAt: bigint;
  commerce: string;
  router: string;
  policy: string;
}

function publicClient(config: CliConfig) {
  return createPublicClient({
    chain: config.chainId === 97 ? bscTestnet : bsc,
    transport: http(config.rpcUrl, { timeout: 20_000 }),
  });
}

// the seller reads the signed quote out of the job description, so the task and
// the proof travel together and the price cannot be swapped after the quote
export function descriptionWithProof(task: string, quote: QuoteResult): string {
  const proof = JSON.stringify({
    price: quote.quote?.price,
    currency: quote.quote?.currency,
    provider_address: quote.quote?.providerAddress,
    valid_until: quote.quote?.validUntil,
    negotiation_hash: quote.quote?.envelope?.negotiation_hash,
    provider_sig: quote.quote?.envelope?.provider_sig,
  });
  const budget = 4096 - new TextEncoder().encode(proof).length - 20;
  const bytes = new TextEncoder().encode(task).length;
  return bytes <= budget ? `${task}\n\nsigned quote: ${proof}` : `${task.slice(0, Math.max(0, budget - 24))}\n[task cut to fit]\n\nsigned quote: ${proof}`;
}

export async function planHire(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  task: string,
  options: { client: string; maxUsd?: number },
): Promise<HirePlan> {
  const quote = await quoteJob(config, chainId, tokenId, task, options.client);
  if (!quote.quote?.price || !quote.quote.currency || !quote.quote.providerAddress || !quote.stack?.commerce || !quote.stack.router || !quote.stack.policy) {
    throw new CliError(quote.error ?? "the seller did not return a complete quote", "quote_incomplete");
  }
  const price = BigInt(quote.quote.price);
  const feeUsd = typeof quote.quote.envelope?.fee_usd === "number" ? quote.quote.envelope.fee_usd : null;
  if (options.maxUsd !== undefined && feeUsd !== null && feeUsd > options.maxUsd) {
    throw new CliError(`the quote is ${feeUsd} U, above the ${options.maxUsd} U cap`, "over_cap");
  }

  const client = publicClient(config);
  const counter = await client.readContract({
    address: quote.stack.commerce as `0x${string}`,
    abi: COMMERCE_ABI,
    functionName: "jobCounter",
  });
  const disputeWindow = await client.readContract({
    address: quote.stack.policy as `0x${string}`,
    abi: POLICY_ABI,
    functionName: "disputeWindow",
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiredAt = now + BigInt(disputeWindow) + 1_800n;

  // the API echoes addresses in mixed case that is not a valid EIP-55 checksum,
  // and viem refuses those at encode time, so normalise once here
  return {
    chainId,
    tokenId,
    agent: quote.agent?.name ?? tokenId,
    description: descriptionWithProof(task, quote),
    price,
    feeUsd,
    currency: getAddress(quote.quote.currency),
    provider: getAddress(quote.quote.providerAddress),
    jobId: counter + 1n,
    expiredAt,
    commerce: getAddress(quote.stack.commerce),
    router: getAddress(quote.stack.router),
    policy: getAddress(quote.stack.policy),
  };
}

export interface HireCall {
  label: string;
  to: string;
  data: Hex;
}

export function hireCalls(plan: HirePlan): HireCall[] {
  return [
    {
      label: "create the job",
      to: plan.commerce,
      data: encodeFunctionData({
        abi: COMMERCE_ABI,
        functionName: "createJob",
        args: [plan.provider as `0x${string}`, plan.router as `0x${string}`, plan.expiredAt, plan.description, plan.router as `0x${string}`],
      }),
    },
    {
      label: "bind the dispute policy",
      to: plan.router,
      data: encodeFunctionData({
        abi: ROUTER_ABI,
        functionName: "registerJob",
        args: [plan.jobId, plan.policy as `0x${string}`],
      }),
    },
    {
      label: "set the agreed price",
      to: plan.commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "setBudget", args: [plan.jobId, plan.price, "0x"] }),
    },
    {
      label: "approve the price",
      to: plan.currency,
      data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [plan.commerce as `0x${string}`, plan.price] }),
    },
    {
      label: "lock the price into escrow",
      to: plan.commerce,
      data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "fund", args: [plan.jobId, plan.price, "0x"] }),
    },
  ];
}

export interface HireSent {
  jobId: string;
  txs: { label: string; hash: Hex }[];
}

export async function fundHire(config: CliConfig, signer: LoadedSigner, plan: HirePlan): Promise<HireSent> {
  const chain = config.chainId === 97 ? bscTestnet : bsc;
  const wallet = createWalletClient({ account: signer.account, chain, transport: http(config.rpcUrl, { timeout: 20_000 }) });
  const client = publicClient(config);
  const txs: { label: string; hash: Hex }[] = [];
  for (const call of hireCalls(plan)) {
    const hash = await wallet.sendTransaction({ to: call.to as `0x${string}`, data: call.data });
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== "success") throw new CliError(`${call.label} reverted (${hash})`, "tx_reverted");
    txs.push({ label: call.label, hash });
  }
  const job = await client.readContract({
    address: plan.commerce as `0x${string}`,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [plan.jobId],
  });
  if (Number(job.status) !== 1) throw new CliError(`job ${plan.jobId} is not funded after the transactions`, "not_funded");
  return { jobId: plan.jobId.toString(), txs };
}

export async function jobStatus(config: CliConfig, commerce: string, jobId: bigint): Promise<{ status: number; budget: bigint; client: string; provider: string }> {
  const job = await publicClient(config).readContract({
    address: commerce as `0x${string}`,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [jobId],
  });
  return { status: Number(job.status), budget: job.budget, client: job.client, provider: job.provider };
}
