import { describe, it, expect } from "vitest";
import type { ScoutCandidate, ScoutVerification, PerformanceMetrics, RatingAggregate } from "../src/lib/scout";

describe("scout types", () => {
  it("ScoutCandidate has required fields", () => {
    const c: ScoutCandidate = {
      agent_id: "56:0x8004a:123",
      token_id: "123",
      chain_id: 56,
      name: "Test Bot",
      description: null,
      category: "grid-trading",
      endpoint: "https://example.com/mcp",
      endpointType: "mcp",
      source: "keyword",
      discoveredAt: new Date().toISOString(),
    };
    expect(c.agent_id).toBe("56:0x8004a:123");
  });

  it("ScoutVerification status values", () => {
    const statuses: ScoutVerification["status"][] = ["delivered", "gated", "dead", "unreachable"];
    expect(statuses).toHaveLength(4);
  });

  it("PerformanceMetrics score range", () => {
    const m: PerformanceMetrics = {
      agent_id: "test",
      tokenId: "1",
      contractAddress: null,
      tradeFrequency: 10,
      volume24h: 1000,
      estimatedPnl: 50,
      winRate: 0.6,
      maxDrawdown: 0.1,
      score: 75,
      lastTrackedAt: new Date().toISOString(),
    };
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(100);
  });

  it("RatingAggregate score calculation", () => {
    const r: RatingAggregate = {
      agent_id: "test",
      total: 10,
      profitable: 7,
      notProfitable: 2,
      scam: 1,
      score: 70,
      lastRatedAt: new Date().toISOString(),
    };
    expect(r.profitable / r.total).toBe(0.7);
  });
});
