import { CategoryKey, AgentSummary } from "./types";

export interface ScoutCandidate {
  agent_id: string;
  token_id: string;
  chain_id: number;
  name: string;
  description: string | null;
  category: CategoryKey | "general";
  endpoint: string | null;
  endpointType: "mcp" | "a2a" | null;
  source: "keyword" | "recent" | "backfill";
  discoveredAt: string;
}

export interface ScoutVerification {
  tokenId: string;
  name: string;
  category: string;
  status: "delivered" | "gated" | "dead" | "unreachable";
  responseMs: number;
  checkedAt: string;
  quality?: { grade: "good" | "partial" | "poor"; reason: string };
  concurrency?: "parallel-ok" | "single-ok" | "untested";
}

export interface PerformanceMetrics {
  agent_id: string;
  tokenId: string;
  contractAddress: string | null;
  tradeFrequency: number;
  volume24h: number;
  estimatedPnl: number;
  winRate: number;
  maxDrawdown: number;
  score: number;
  lastTrackedAt: string;
}

export interface UserRating {
  agent_id: string;
  user: string;
  rating: "profitable" | "not_profitable" | "scam";
  txHash: string;
  timestamp: string;
}

export interface RatingAggregate {
  agent_id: string;
  total: number;
  profitable: number;
  notProfitable: number;
  scam: number;
  score: number;
  lastRatedAt: string;
}

export interface ScoutLog {
  runId: string;
  startedAt: string;
  completedAt: string;
  phase: "discover" | "verify" | "track" | "curate" | "full";
  discovered: number;
  verified: number;
  tracked: number;
  added: number;
  pruned: number;
  errors: string[];
}

export interface ScoutSnapshot {
  version: number;
  snapshotTime: string;
  source: { fetched: number; upstreamTotal: number; deduped: number };
  counts: Record<string, number>;
  agents: (AgentSummary & { scout?: { discoveredAt: string; verification?: ScoutVerification; performance?: PerformanceMetrics; rating?: RatingAggregate } })[];
}
