import { createPublicClient, createWalletClient, encodeFunctionData, http, stringToHex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import {
  encodeErc8183Manifest,
  erc8183Addresses,
  erc8183ManifestHash,
  type Erc8183DeliverableManifest,
} from "@altananetwork/sdk";
import { signerFor, type SellerConfig } from "./quote.js";

const RPC_URL: Record<number, string> = {
  97: "https://data-seed-prebsc-2-s2.binance.org:8545",
  56: "https://bsc-dataseed.bnbchain.org",
};

// the kernel returns the job as one struct, so the output is a single tuple
const COMMERCE_ABI = [
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
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

export const JOB_FUNDED = 1;

export interface KernelJob {
  client: string;
  provider: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
}

export type ReadJob = (cfg: SellerConfig, jobId: bigint) => Promise<KernelJob | null>;

const chainOf = (chainId: number) => (chainId === 97 ? bscTestnet : bsc);
const transportOf = (cfg: SellerConfig) => http(cfg.rpcUrl ?? RPC_URL[cfg.chainId]);

export const readKernelJob: ReadJob = async (cfg, jobId) => {
  const stack = erc8183Addresses(cfg.chainId);
  const client = createPublicClient({ chain: chainOf(cfg.chainId), transport: transportOf(cfg) });
  const job = await client.readContract({
    address: stack.commerce as `0x${string}`,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [jobId],
  });
  return {
    client: job.client,
    provider: job.provider,
    description: job.description,
    budget: job.budget,
    expiredAt: job.expiredAt,
    status: Number(job.status),
  };
};

export type NotifyVerification =
  | { ok: true; jobId: bigint; description: string; budget: bigint }
  | { ok: false; reason: string };

/**
 * Check a notify_funded part against the kernel before doing any work.
 * The message is only a hint; the chain's own row is the fact.
 */
export async function verifyNotify(
  cfg: SellerConfig,
  notifyData: { job_id: unknown },
  readJob: ReadJob = readKernelJob,
): Promise<NotifyVerification> {
  const id = Number(notifyData.job_id);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "the notify_funded step carries no parseable job_id" };
  let job: KernelJob | null;
  try {
    job = await readJob(cfg, BigInt(id));
  } catch {
    return { ok: false, reason: `the kernel would not read job ${id} on chain ${cfg.chainId}` };
  }
  if (!job) return { ok: false, reason: `the kernel has no row for job ${id} on chain ${cfg.chainId}` };
  if (job.provider.toLowerCase() !== cfg.providerWallet.toLowerCase()) {
    return { ok: false, reason: `kernel job ${id} names another wallet as its provider` };
  }
  if (job.status !== JOB_FUNDED) return { ok: false, reason: `kernel job ${id} is not Funded (status ${job.status})` };
  return { ok: true, jobId: BigInt(id), description: job.description, budget: job.budget };
}

export interface Answer {
  content: string;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export interface BuiltDeliverable {
  /** serve exactly this text at deliverableUrl; the buyer hashes what it fetches */
  manifestText: string;
  deliverable: `0x${string}`;
  optParams: `0x${string}`;
  deliverableUrl: string;
}

export function buildDeliverable(cfg: SellerConfig, jobId: bigint, answer: Answer): BuiltDeliverable {
  const stack = erc8183Addresses(cfg.chainId);
  const manifest: Erc8183DeliverableManifest = {
    version: 1,
    job_id: Number(jobId),
    chain_id: cfg.chainId,
    contracts: { commerce: stack.commerce, router: stack.router, policy: stack.policy },
    response: { content: answer.content, content_type: answer.contentType },
    metadata: answer.metadata ?? {},
  };
  const deliverableUrl = cfg.deliverableUrl(jobId);
  return {
    manifestText: encodeErc8183Manifest(manifest),
    deliverable: erc8183ManifestHash(manifest),
    optParams: stringToHex(JSON.stringify({ deliverable_url: deliverableUrl })),
    deliverableUrl,
  };
}

export interface ManifestStore {
  save(jobId: string, manifestText: string): Promise<void> | void;
  get(jobId: string): Promise<string | null> | string | null;
}

/** Keeps manifests in memory. Use a durable store in production, or a restart loses what the chain committed to. */
export function memoryManifestStore(): ManifestStore {
  const held = new Map<string, string>();
  return {
    save: (jobId, text) => void held.set(jobId, text),
    get: (jobId) => held.get(jobId) ?? null,
  };
}

export type SubmitResult =
  | { ok: true; txHash: string; deliverableUrl: string }
  | { ok: false; reason: string };

/**
 * Submit the deliverable hash from the provider wallet, which pays its own gas.
 * The manifest is stored before the transaction is sent, so the url already
 * answers when the buyer reads the chain.
 */
export async function submitDeliverable(
  cfg: SellerConfig,
  jobId: bigint,
  answer: Answer,
  store: ManifestStore,
): Promise<SubmitResult> {
  const signer = signerFor(cfg);
  if (!signer.ok) return { ok: false, reason: signer.reason };
  let built: BuiltDeliverable;
  try {
    built = buildDeliverable(cfg, jobId, answer);
  } catch {
    return { ok: false, reason: `the ERC-8183 kernel is not deployed on chain ${cfg.chainId}` };
  }
  await store.save(jobId.toString(), built.manifestText);
  const chain = chainOf(cfg.chainId);
  const wallet = createWalletClient({ account: signer.account, chain, transport: transportOf(cfg) });
  const client = createPublicClient({ chain, transport: transportOf(cfg) });
  const txHash = await wallet.sendTransaction({
    to: erc8183Addresses(cfg.chainId).commerce as `0x${string}`,
    data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: "submit", args: [jobId, built.deliverable, built.optParams] }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { ok: false, reason: `the submit transaction ${txHash} reverted` };
  return { ok: true, txHash, deliverableUrl: built.deliverableUrl };
}
