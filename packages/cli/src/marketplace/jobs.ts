import type { CliConfig } from "../core/config";
import { apiRequest, query } from "../core/http";

// The negotiate step: the marketplace dials the seller and returns the signed
// quote plus the contracts the fund step would target. Read-only, no spend.
export interface QuoteResult {
  success?: boolean;
  quote?: {
    price?: string;
    currency?: string;
    providerAddress?: string;
    validUntil?: number;
    agentId?: string;
    envelope?: { fee_usd?: number; capital_usd?: number; [key: string]: unknown };
  };
  stack?: { commerce?: string; router?: string; policy?: string; paymentToken?: string };
  agent?: { token_id?: string; name?: string };
  error?: string;
}

export async function quoteJob(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  task: string,
  client?: string,
): Promise<QuoteResult> {
  return apiRequest<QuoteResult>(config.apiUrl, "/api/jobs8183/quote", {
    method: "POST",
    body: { chainId, tokenId, task, ...(client ? { client } : {}) },
    timeoutMs: 90_000,
  });
}

export interface JobRecord {
  id?: string;
  client?: string;
  provider?: string;
  description?: string;
  paymentId?: string;
  chainId?: number;
  tokenId?: string;
  agentName?: string;
  status?: string;
  budgetUsd?: number | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface JobsPage {
  success?: boolean;
  jobs?: JobRecord[];
  error?: string;
}

export async function listJobs(config: CliConfig, limit: number): Promise<JobsPage> {
  return apiRequest<JobsPage>(config.apiUrl, `/api/jobs${query({ limit })}`, { timeoutMs: 30_000 });
}

// the job route looks a job up by payment id, not by its own id, so a job id is
// resolved against the recent list the API already serves
export async function showJob(config: CliConfig, id: string): Promise<JobRecord> {
  const direct = await apiRequest<JobsPage>(config.apiUrl, `/api/jobs${query({ paymentId: id })}`, { timeoutMs: 30_000 });
  const hit = direct.jobs?.[0];
  if (hit) return hit;
  const page = await apiRequest<JobsPage>(config.apiUrl, `/api/jobs${query({ limit: 100 })}`, { timeoutMs: 30_000 });
  const job = (page.jobs ?? []).find((candidate) => candidate.id === id || candidate.paymentId === id);
  if (!job) throw new Error(`no job ${id} in the recent list`);
  return job;
}

// the marketplace verifies the kernel job against its own row and calls the
// seller's notify_funded step, so the CLI does not dial the seller directly
export async function notifyJob(
  config: CliConfig,
  body: { chainId: number; tokenId: string; kernelJobId: string; client: string; task: string },
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(config.apiUrl, "/api/jobs8183/jobs", {
    method: "POST",
    body,
    timeoutMs: 90_000,
  });
}
