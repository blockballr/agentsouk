import { isNegotiateData, isNotifyData } from "./protocol.js";
import { quoteEnvelope, type SellerConfig } from "./quote.js";
import {
  readKernelJob,
  submitDeliverable,
  verifyNotify,
  type Answer,
  type ManifestStore,
  type ReadJob,
  type SubmitResult,
} from "./kernel.js";

/** The work the agent does: the funded job's description in, the answer out. */
export type SellerWork = (task: string, job: { jobId: bigint; budget: bigint }) => Answer | Promise<Answer>;

export interface SellerReply {
  /** none means no part was a job step, so the caller answers the message its own way */
  kind: "quote" | "ack" | "unsigned" | "refused" | "none";
  /** the data part to send back, null when kind is none */
  envelope: Record<string, unknown> | null;
}

export interface SellerHooks {
  work: SellerWork;
  store: ManifestStore;
  readJob?: ReadJob;
  submit?: (cfg: SellerConfig, jobId: bigint, answer: Answer, store: ManifestStore) => Promise<SubmitResult>;
}

const refusal = (reason: string): SellerReply => ({ kind: "refused", envelope: { status: "refused", unsigned_reason: reason } });

/**
 * One entry point for an A2A route. Pass the message parts; a negotiate part
 * comes back as a signed quote, a notify_funded part is checked on chain, worked
 * and submitted, and anything else falls through.
 */
export async function handleSellerParts(cfg: SellerConfig, parts: unknown, hooks: SellerHooks): Promise<SellerReply> {
  for (const part of Array.isArray(parts) ? parts : []) {
    const data = part && typeof part === "object" ? (part as { data?: unknown }).data : null;
    if (isNegotiateData(data)) {
      const quote = await quoteEnvelope(cfg, data);
      if (quote.ok) return { kind: "quote", envelope: { ...quote.envelope } };
      return { kind: quote.status, envelope: { status: quote.status, unsigned_reason: quote.unsigned_reason } };
    }
    if (isNotifyData(data)) {
      const funded = await verifyNotify(cfg, data, hooks.readJob ?? readKernelJob);
      if (!funded.ok) return refusal(funded.reason);
      const answer = await hooks.work(funded.description, { jobId: funded.jobId, budget: funded.budget });
      const submitted = await (hooks.submit ?? submitDeliverable)(cfg, funded.jobId, answer, hooks.store);
      if (!submitted.ok) return refusal(`the deliverable was not submitted: ${submitted.reason}`);
      return {
        kind: "ack",
        envelope: {
          status: "acknowledged",
          job_id: funded.jobId.toString(),
          submit_tx: submitted.txHash,
          deliverable_url: submitted.deliverableUrl,
        },
      };
    }
  }
  return { kind: "none", envelope: null };
}
