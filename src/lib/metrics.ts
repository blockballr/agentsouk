// off-chain delivery metrics per agent, in-memory per process

export interface AgentMetrics {
  tokenId: string;
  delivered: number;
  failed: number;
  gated: number;
  total: number;
  successRate: number;
  avgQuality: number;
}

const byAgent = new Map<string, { delivered: number; failed: number; gated: number; qualitySum: number; qualityN: number }>();

export function recordDeliveryMetric(
  tokenId: string,
  outcome: "delivered" | "failed" | "gated",
  qualityScore?: number,
): void {
  const cur = byAgent.get(tokenId) ?? { delivered: 0, failed: 0, gated: 0, qualitySum: 0, qualityN: 0 };
  if (outcome === "delivered") cur.delivered += 1;
  else if (outcome === "gated") cur.gated += 1;
  else cur.failed += 1;
  if (typeof qualityScore === "number") {
    cur.qualitySum += qualityScore;
    cur.qualityN += 1;
  }
  byAgent.set(tokenId, cur);
}

export function getAgentMetrics(tokenId: string): AgentMetrics {
  const cur = byAgent.get(tokenId) ?? { delivered: 0, failed: 0, gated: 0, qualitySum: 0, qualityN: 0 };
  const total = cur.delivered + cur.failed + cur.gated;
  return {
    tokenId,
    delivered: cur.delivered,
    failed: cur.failed,
    gated: cur.gated,
    total,
    successRate: total ? Number((cur.delivered / total).toFixed(2)) : 0,
    avgQuality: cur.qualityN ? Number((cur.qualitySum / cur.qualityN).toFixed(2)) : 0,
  };
}
