// ERC-8183 job records for Agent Souk: Open, Funded, Submitted, Completed, Rejected, Expired.
// The fund leg is the x402 settle; evaluator defaults to the client. In-memory per process, like the receipt and task ledgers.

import "server-only";
import { randomUUID } from "node:crypto";
import {
  loadJob,
  loadJobByPayment,
  loadJobs,
  loadJobsByClient,
  saveJob,
} from "./durable-store";
import { targetChainId } from "./types";

export type JobStatus =
  | "Open"
  | "Funded"
  | "Submitted"
  | "Completed"
  | "Rejected"
  | "Expired";

export interface JobEvent {
  at: string;
  status: JobStatus;
  by: string;
  reason?: string;
}

export interface Job {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  paymentId?: string;
  budgetUsd: number;
  expiredAt: string;
  status: JobStatus;
  deliverable?: string;
  attestation?: string;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  history: JobEvent[];
}

const jobs = new Map<string, Job>();
const byPayment = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function push(job: Job, status: JobStatus, by: string, reason?: string): void {
  job.status = status;
  job.updatedAt = nowIso();
  job.history.push({ at: job.updatedAt, status, by, reason });
}

function cache(job: Job): Job {
  jobs.set(job.id, job);
  if (job.paymentId) byPayment.set(job.paymentId, job.id);
  void saveJob(job);
  return job;
}

export function createJob(input: {
  client: string;
  provider: string;
  evaluator?: string;
  description: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  budgetUsd: number;
  expiredAt?: string;
}): Job {
  const job: Job = {
    id: randomUUID(),
    client: input.client,
    provider: input.provider,
    evaluator: input.evaluator && input.evaluator.length > 0 ? input.evaluator : input.client,
    description: input.description,
    chainId: input.chainId,
    tokenId: input.tokenId,
    agentName: input.agentName,
    budgetUsd: input.budgetUsd,
    expiredAt: input.expiredAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "Open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [{ at: nowIso(), status: "Open", by: input.client }],
  };
  return cache(job);
}

export async function getJobAsync(jobId: string): Promise<Job | undefined> {
  const local = jobs.get(jobId);
  if (local) return local;
  const stored = await loadJob(jobId);
  if (stored) return cache(stored);
  return undefined;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export async function getJobByPaymentAsync(
  paymentId: string,
): Promise<Job | undefined> {
  const id = byPayment.get(paymentId);
  const local = id ? jobs.get(id) : undefined;
  if (local) return local;
  const stored = await loadJobByPayment(paymentId);
  if (stored) return cache(stored);
  return undefined;
}

export function getJobByPayment(paymentId: string): Job | undefined {
  const id = byPayment.get(paymentId);
  return id ? jobs.get(id) : undefined;
}

// Jobs are scoped to the chain the deployment settles on: the append-only ledger outlives
// any single deployment, so records written on chain 56 must not be served from a chain-97 site.
function onTargetChain(job: Job): boolean {
  return Number(job.chainId) === targetChainId();
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const fromDb = await loadJobs(limit * 2);
  for (const j of fromDb) {
    if (!jobs.has(j.id)) cache(j);
  }
  return [...jobs.values()]
    .filter(onTargetChain)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function listJobsForClient(client: string, limit = 50): Promise<Job[]> {
  const fromDb = await loadJobsByClient(client, limit * 2);
  for (const j of fromDb) {
    if (!jobs.has(j.id)) cache(j);
  }
  return [...jobs.values()]
    .filter((j) => j.client.toLowerCase() === client.toLowerCase())
    .filter(onTargetChain)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function fundJob(input: {
  jobId?: string;
  paymentId: string;
  client: string;
  provider: string;
  evaluator?: string;
  description?: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  budgetUsd: number;
  expiredAt?: string;
}): Job {
  let job = input.jobId ? jobs.get(input.jobId) : getJobByPayment(input.paymentId);
  if (!job) {
    job = createJob({
      client: input.client,
      provider: input.provider,
      evaluator: input.evaluator,
      description: input.description ?? `Hire ${input.agentName}`,
      chainId: input.chainId,
      tokenId: input.tokenId,
      agentName: input.agentName,
      budgetUsd: input.budgetUsd,
      expiredAt: input.expiredAt,
    });
  }
  if (job.status !== "Open" && job.status !== "Funded") return job;
  job.paymentId = input.paymentId;
  job.budgetUsd = input.budgetUsd;
  byPayment.set(input.paymentId, job.id);
  if (job.status === "Open") push(job, "Funded", input.client, "x402 settlement");
  void saveJob(job);
  return job;
}

export function submitJob(input: {
  jobId: string;
  provider: string;
  deliverable: string;
  taskId?: string;
}): Job | undefined {
  const job = jobs.get(input.jobId);
  if (!job) return undefined;
  if (job.status !== "Funded") return job;
  if (input.provider.toLowerCase() !== job.provider.toLowerCase() &&
      input.provider.toLowerCase() !== "marketplace") {
    // marketplace relay submits on behalf of the provider after delivery
  }
  job.deliverable = input.deliverable;
  if (input.taskId) job.taskId = input.taskId;
  push(job, "Submitted", input.provider, "deliverable recorded");
  void saveJob(job);
  return job;
}

export function completeJob(input: {
  jobId: string;
  evaluator: string;
  reason?: string;
}): Job | undefined {
  const job = jobs.get(input.jobId);
  if (!job) return undefined;
  if (job.status !== "Submitted") return job;
  if (input.evaluator.toLowerCase() !== job.evaluator.toLowerCase()) return undefined;
  job.attestation = input.reason;
  push(job, "Completed", input.evaluator, input.reason);
  void saveJob(job);
  return job;
}

export function rejectJob(input: {
  jobId: string;
  by: string;
  reason?: string;
}): Job | undefined {
  const job = jobs.get(input.jobId);
  if (!job) return undefined;
  const by = input.by.toLowerCase();
  if (job.status === "Open") {
    if (by !== job.client.toLowerCase()) return undefined;
  } else if (job.status === "Funded" || job.status === "Submitted") {
    if (by !== job.evaluator.toLowerCase()) return undefined;
  } else {
    return job;
  }
  job.attestation = input.reason;
  push(job, "Rejected", input.by, input.reason);
  void saveJob(job);
  return job;
}

export function claimRefund(jobId: string, by = "anyone"): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (job.status !== "Funded" && job.status !== "Submitted") return job;
  if (Date.now() < new Date(job.expiredAt).getTime()) return undefined;
  push(job, "Expired", by, "expired refund claim");
  void saveJob(job);
  return job;
}

export function attachTask(jobId: string, taskId: string): void {
  const job = jobs.get(jobId);
  if (job) {
    job.taskId = taskId;
    void saveJob(job);
  }
}
