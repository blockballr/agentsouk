import "server-only";
import type { HireTask } from "./tasks";
import type { Job } from "./jobs";
import { durableMode, loadHireTasksByToken, loadJobsByToken } from "./durable-store";
import { isTeamWallet, isVerifierPayment } from "./team-wallets";

// what the marketplace itself observed of one agent, from the durable job and task rows
// rather than anything the agent says about itself
// a buyer hire is a funded job that is not a verifier probe, not from a team wallet, and not
// the owner hiring its own agent; the verifier's probes are kept apart as a history
export interface TrackRecord {
  chainId: number;
  tokenId: string;
  observed: boolean;
  hires: number;
  completed: number;
  deliveries: { delivered: number; failed: number; gated: number };
  successRate: number | null;
  grades: { good: number; partial: number; poor: number };
  probes: { delivered: number; failed: number; gated: number; lastAt: string | null };
  firstHireAt: string | null;
  lastHireAt: string | null;
}

type Outcome = "delivered" | "failed" | "gated";

function outcome(task: HireTask): Outcome | null {
  return task.status === "delivered" || task.status === "failed" || task.status === "gated" ? task.status : null;
}

export function summariseTrackRecord(
  chainId: number,
  tokenId: string,
  jobs: readonly Job[],
  tasks: readonly HireTask[],
  owner?: string | null,
): Omit<TrackRecord, "observed"> {
  const self = owner?.toLowerCase() ?? null;
  const buyerJobs = jobs.filter((j) => {
    if (!j.paymentId || j.status === "Open") return false;
    if (isVerifierPayment(j.paymentId) || isTeamWallet(j.client)) return false;
    const client = j.client.toLowerCase();
    return client !== self && client !== j.provider.toLowerCase();
  });
  const buyerPayments = new Set(buyerJobs.map((j) => j.paymentId));

  const deliveries = { delivered: 0, failed: 0, gated: 0 };
  const grades = { good: 0, partial: 0, poor: 0 };
  const probes = { delivered: 0, failed: 0, gated: 0, lastAt: null as string | null };
  for (const task of tasks) {
    const result = outcome(task);
    if (!result) continue;
    if (isVerifierPayment(task.paymentId)) {
      probes[result] += 1;
      if (!probes.lastAt || task.updatedAt > probes.lastAt) probes.lastAt = task.updatedAt;
    } else if (buyerPayments.has(task.paymentId)) {
      deliveries[result] += 1;
      if (task.quality) grades[task.quality.grade] += 1;
    }
  }

  const attempts = deliveries.delivered + deliveries.failed + deliveries.gated;
  const hireTimes = buyerJobs.map((j) => j.createdAt).sort();
  return {
    chainId,
    tokenId,
    hires: buyerJobs.length,
    completed: buyerJobs.filter((j) => j.status === "Completed").length,
    deliveries,
    successRate: attempts ? Number((deliveries.delivered / attempts).toFixed(2)) : null,
    grades,
    probes,
    firstHireAt: hireTimes[0] ?? null,
    lastHireAt: hireTimes[hireTimes.length - 1] ?? null,
  };
}

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; record: TrackRecord }>();

// without the durable store there is nothing to observe across instances, so the
// record says so instead of reporting a confident zero
export async function loadTrackRecord(
  chainId: number,
  tokenId: string,
  owner?: string | null,
): Promise<TrackRecord> {
  const key = `${chainId}:${tokenId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.record;
  const observed = durableMode() === "postgres";
  const [jobs, tasks] = observed
    ? await Promise.all([loadJobsByToken(chainId, tokenId), loadHireTasksByToken(chainId, tokenId)])
    : [[], []];
  const record = { ...summariseTrackRecord(chainId, tokenId, jobs, tasks, owner), observed };
  cache.set(key, { at: Date.now(), record });
  return record;
}
