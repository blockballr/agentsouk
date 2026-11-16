// what a seller's ERC-8183 jobs add up to. status codes follow the kernel:
// 0 open, 1 funded, 2 submitted, 3 completed, 4 rejected, 5 expired

export interface IndexedJob {
  chainId: number;
  jobId: number;
  client: string;
  provider: string;
  budget: string;
  status: number;
  expiredAt: number;
  submittedAt: number;
}

export interface ProviderJobStats {
  total: number;
  completed: number;
  rejected: number;
  expired: number;
  inProgress: number;
  // budget of completed jobs, in the payment token's base units
  settled: string;
  buyers: number;
  // buyers with more than one completed job
  repeatBuyers: number;
}

export function summarizeProviderJobs(jobs: IndexedJob[], nowSeconds: number): ProviderJobStats {
  let completed = 0;
  let rejected = 0;
  let expired = 0;
  let inProgress = 0;
  let settled = 0n;
  const completedBy = new Map<string, number>();
  const buyers = new Set<string>();
  for (const j of jobs) {
    buyers.add(j.client);
    // a funded job past its expiry is refundable, so it counts as expired, not as work in hand
    const lapsed = j.status < 3 && j.expiredAt > 0 && j.expiredAt < nowSeconds;
    if (j.status === 3) {
      completed++;
      settled += BigInt(j.budget);
      completedBy.set(j.client, (completedBy.get(j.client) ?? 0) + 1);
    } else if (j.status === 4) rejected++;
    else if (j.status === 5 || lapsed) expired++;
    else inProgress++;
  }
  return {
    total: jobs.length,
    completed,
    rejected,
    expired,
    inProgress,
    settled: settled.toString(),
    buyers: buyers.size,
    repeatBuyers: [...completedBy.values()].filter((n) => n > 1).length,
  };
}
