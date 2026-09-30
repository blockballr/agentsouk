// the browse route hands the visitor's seed to the shelf, and lets the verifier's sweep
// see the team's agents even while the shelf hides them
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const scanner = vi.hoisted(() => ({
  queryAgents: vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    limit: 24,
    indexStatus: { snapshotTotal: 0, registryTotal: 0, snapshotTime: null, lastTopUpAt: null, catalogueRefreshedAt: null },
    categoryCounts: {},
  })),
}));
vi.mock("@/lib/scanner", () => scanner);
vi.mock("@/lib/verifications", () => ({ loadVerifications: async () => new Map() }));
vi.mock("@/lib/pancakeswap", () => ({ isPancakeSwapAgent: () => false, readsPancakeSwap: () => false }));
vi.mock("@/lib/x402", () => ({ findActiveSession: () => undefined }));
vi.mock("@/lib/receipts-store", () => ({ revokedAmong: async () => new Set() }));
vi.mock("@/lib/boosts", () => ({ hydrateBoostsFromDb: async () => {}, isBoosted: () => false }));

import { GET } from "../src/app/api/agents/route";

describe("browse route", () => {
  it("passes the visit seed through and hides nothing extra by default", async () => {
    await GET(new NextRequest("https://api.agentsouk.xyz/api/agents?seed=abc123"));
    expect(scanner.queryAgents).toHaveBeenLastCalledWith(expect.objectContaining({ seed: "abc123", includeHouse: false }));
  });

  it("includes the house agents for the verifier's sweep", async () => {
    await GET(new NextRequest("https://api.agentsouk.xyz/api/agents?limit=200&house=all"));
    expect(scanner.queryAgents).toHaveBeenLastCalledWith(expect.objectContaining({ includeHouse: true }));
  });
});
