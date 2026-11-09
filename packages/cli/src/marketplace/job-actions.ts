import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

// The marketplace drives a job through four signed actions. The signature binds
// the action to one job and one address, and the text is exactly what the route
// rebuilds in src/lib/jobs.ts, so the copy here is kept equal by a test.

export type JobActionName = "submit" | "complete" | "reject" | "claimRefund";

export function jobActionMessage(input: {
  jobId: string;
  action: string;
  address: string;
  reason?: string;
  deliverable?: string;
}): string {
  return [
    "Agent Souk job action",
    `jobId: ${input.jobId}`,
    `action: ${input.action}`,
    `address: ${input.address.toLowerCase()}`,
    `reason: ${input.reason ?? ""}`,
    `deliverable: ${input.deliverable ?? ""}`,
  ].join("\n");
}

export interface JobActionResult {
  success?: boolean;
  job?: {
    id?: string;
    status?: string;
    deliverable?: string;
    updatedAt?: string;
    [key: string]: unknown;
  };
  error?: string;
}

export interface JobActionExtra {
  reason?: string;
  deliverable?: string;
}

export async function actOnJob(
  config: CliConfig,
  signer: LoadedSigner,
  jobId: string,
  action: JobActionName,
  extra: JobActionExtra = {},
): Promise<JobActionResult> {
  const signature = await signer.signMessage(
    jobActionMessage({ jobId, action, address: signer.address, ...extra }),
  );
  return apiRequest<JobActionResult>(config.apiUrl, `/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "POST",
    body: {
      action,
      by: signer.address,
      reason: extra.reason,
      deliverable: extra.deliverable,
      signature,
    },
    // claimRefund reads the kernel or the escrow before it writes, so it gets room
    timeoutMs: 90_000,
  });
}
