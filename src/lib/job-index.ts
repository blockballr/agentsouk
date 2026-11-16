// every ERC-8183 job on the kernel, read from contract state rather than logs,
// since the public endpoint drops logs older than about a day. job ids run
// from 1 upward, so a sync reads past the last known id until it finds no job,
// then refreshes jobs that had not settled yet. with no database it lives in
// process memory

import "server-only";
import postgres from "postgres";
import { createPublicClient, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { erc8183Stack } from "@/lib/jobs8183";
import { rpcTransport } from "@/lib/rpc";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { summarizeProviderJobs, type IndexedJob, type ProviderJobStats } from "@/lib/job-stats";

export type { IndexedJob, ProviderJobStats } from "@/lib/job-stats";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 10 });
}

const memory = new Map<string, IndexedJob>();
let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  tableReady ??= (async () => {
    try {
      await sql!`
        create table if not exists kernel_jobs (
          chain_id integer not null,
          job_id bigint not null,
          client text not null,
          provider text not null,
          budget text not null,
          status smallint not null,
          expired_at bigint not null,
          submitted_at bigint not null,
          primary key (chain_id, job_id)
        )
      `;
      await sql!`create index if not exists kernel_jobs_provider on kernel_jobs (chain_id, provider)`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

const GET_JOB_ABI = [
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
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const BATCH = 250;

function client(chainId: number) {
  const chain = chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
  return createPublicClient({ chain, transport: rpcTransport(chainId) });
}

async function readJobs(chainId: number, ids: number[]): Promise<(IndexedJob | null)[]> {
  const stack = erc8183Stack(chainId);
  if (!stack || ids.length === 0) return [];
  const rows = await client(chainId).multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({
      address: stack.commerce as Address,
      abi: GET_JOB_ABI,
      functionName: "getJob" as const,
      args: [BigInt(id)] as const,
    })),
  });
  return rows.map((row, i) => {
    if (row.status !== "success") return null;
    const job = row.result;
    if (job.client === ZERO) return null;
    return {
      chainId,
      jobId: ids[i]!,
      client: job.client.toLowerCase(),
      provider: job.provider.toLowerCase(),
      budget: job.budget.toString(),
      status: Number(job.status),
      expiredAt: Number(job.expiredAt),
      submittedAt: Number(job.submittedAt),
    };
  });
}

async function save(jobs: IndexedJob[]): Promise<void> {
  if (jobs.length === 0) return;
  if (await ensureTable()) {
    for (let i = 0; i < jobs.length; i += 500) {
      const part = jobs.slice(i, i + 500).map((j) => ({
        chain_id: j.chainId,
        job_id: j.jobId,
        client: j.client,
        provider: j.provider,
        budget: j.budget,
        status: j.status,
        expired_at: j.expiredAt,
        submitted_at: j.submittedAt,
      }));
      await sql!`
        insert into kernel_jobs ${sql!(part)}
        on conflict (chain_id, job_id) do update set
          status = excluded.status, submitted_at = excluded.submitted_at, budget = excluded.budget
      `;
    }
    return;
  }
  for (const j of jobs) memory.set(`${j.chainId}:${j.jobId}`, j);
}

async function lastIndexedId(chainId: number): Promise<number> {
  if (await ensureTable()) {
    const rows = await sql!`select coalesce(max(job_id), 0) as last from kernel_jobs where chain_id = ${chainId}`;
    return Number(rows[0]?.last ?? 0);
  }
  let last = 0;
  for (const j of memory.values()) if (j.chainId === chainId && j.jobId > last) last = j.jobId;
  return last;
}

async function unsettledIds(chainId: number, limit: number): Promise<number[]> {
  // 0 open, 1 funded and 2 submitted can still change; 3 to 5 are final.
  // a job a week past its expiry is left alone: it can only be refunded, and
  // the stats already count it as expired, so rereading it forever buys nothing
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86_400;
  if (await ensureTable()) {
    const rows = await sql!`
      select job_id from kernel_jobs where chain_id = ${chainId} and status < 3
        and (expired_at = 0 or expired_at > ${cutoff})
      order by job_id desc limit ${limit}
    `;
    return rows.map((r) => Number(r.job_id));
  }
  return [...memory.values()]
    .filter((j) => j.chainId === chainId && j.status < 3 && (j.expiredAt === 0 || j.expiredAt > cutoff))
    .sort((a, b) => b.jobId - a.jobId)
    .slice(0, limit)
    .map((j) => j.jobId);
}

export interface SyncResult {
  chainId: number;
  added: number;
  refreshed: number;
  lastJobId: number;
  reachedEnd: boolean;
}

// reads up to maxNew new jobs and refreshes up to maxRefresh unsettled ones,
// so one run stays inside a function's time limit and later runs catch up
export async function syncJobIndex(chainId: number, maxNew = 5000, maxRefresh = 2000): Promise<SyncResult> {
  let next = (await lastIndexedId(chainId)) + 1;
  let added = 0;
  let reachedEnd = false;
  while (added < maxNew) {
    const ids = Array.from({ length: BATCH }, (_, i) => next + i);
    const rows = await readJobs(chainId, ids);
    const found: IndexedJob[] = [];
    for (const row of rows) {
      if (!row) {
        reachedEnd = true;
        break;
      }
      found.push(row);
    }
    await save(found);
    added += found.length;
    next += found.length;
    if (reachedEnd) break;
  }

  const stale = await unsettledIds(chainId, maxRefresh);
  let refreshed = 0;
  for (let i = 0; i < stale.length; i += BATCH) {
    const rows = (await readJobs(chainId, stale.slice(i, i + BATCH))).filter((r): r is IndexedJob => r !== null);
    await save(rows);
    refreshed += rows.length;
  }
  return { chainId, added, refreshed, lastJobId: next - 1, reachedEnd };
}

export async function jobsForProviders(chainId: number, wallets: string[]): Promise<IndexedJob[]> {
  const set = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (set.length === 0) return [];
  if (await ensureTable()) {
    const rows = await sql!`
      select * from kernel_jobs where chain_id = ${chainId} and provider in ${sql!(set)}
    `;
    return rows.map((r) => ({
      chainId: Number(r.chain_id),
      jobId: Number(r.job_id),
      client: String(r.client),
      provider: String(r.provider),
      budget: String(r.budget),
      status: Number(r.status),
      expiredAt: Number(r.expired_at),
      submittedAt: Number(r.submitted_at),
    }));
  }
  return [...memory.values()].filter((j) => j.chainId === chainId && set.includes(j.provider));
}

// the provider wallets named on given kernel jobs, read from the index
export async function providersOfJobs(chainId: number, jobIds: number[]): Promise<string[]> {
  const ids = [...new Set(jobIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  if (await ensureTable()) {
    const rows = await sql!`select distinct provider from kernel_jobs where chain_id = ${chainId} and job_id in ${sql!(ids)}`;
    return rows.map((r) => String(r.provider));
  }
  return [...new Set([...memory.values()].filter((j) => j.chainId === chainId && ids.includes(j.jobId)).map((j) => j.provider))];
}

export async function indexedThrough(chainId: number): Promise<number> {
  return lastIndexedId(chainId);
}

export async function providerJobStats(chainId: number, wallets: string[], nowSeconds = Math.floor(Date.now() / 1000)): Promise<ProviderJobStats> {
  return summarizeProviderJobs(await jobsForProviders(chainId, wallets), nowSeconds);
}
