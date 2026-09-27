// Pins the durable shelf store's testable half: what a summary becomes as a
// stored row, what a row becomes when read back through the admission gate, and
// that the absent-database path stays a no-op. No Postgres is touched here.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deleteShelfAgent,
  loadShelfAgents,
  rowFromSummary,
  saveShelfAgents,
  shelfStoreMode,
  summaryFromRow,
} from "../src/lib/shelf-store";
import type { AgentSummary } from "../src/lib/types";

// Clear the URL before any store call resolves its client, so this file never
// opens a connection even on a machine with a database configured.
delete process.env.DATABASE_URL;

function summary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agent_id: "97:0x8004:1",
    token_id: "1",
    chain_id: 97,
    contract_address: "0x8004",
    owner_address: "0xOwner",
    name: "Yield Bot",
    description: "auto compound yield across venues",
    image_url: null,
    is_verified: false,
    star_count: 0,
    x402_supported: true,
    total_score: 12,
    average_score: 4,
    total_feedbacks: 3,
    health_score: null,
    supported_trust_models: ["reputation"],
    a2a_endpoint: "https://agent.example/.well-known/agent-card.json",
    mcp_server: null,
    is_active: true,
    created_at: "2026-09-26T00:00:00Z",
    category: "yield",
    categoryScores: { yield: 3 },
    ...overrides,
  };
}

describe("what a top up persists", () => {
  it("stores the shelf summary keyed by chain and token", () => {
    const s = summary();
    const row = rowFromSummary(s, "2026-09-27T00:00:00.000Z");
    expect(row.chain_id).toBe(97);
    expect(row.token_id).toBe("1");
    expect(row.updated_at).toBe("2026-09-27T00:00:00.000Z");
    // exactly the summary the shelf serves, so the full registry record is never stored
    expect(row.payload).toEqual(s);
    expect(Object.keys(row).sort()).toEqual([
      "chain_id",
      "payload",
      "token_id",
      "updated_at",
    ]);
  });

  it("keys the same token apart across chains", () => {
    expect(rowFromSummary(summary({ chain_id: 56 })).chain_id).toBe(56);
    expect(rowFromSummary(summary({ chain_id: 97 })).chain_id).toBe(97);
  });
});

describe("what a durable row becomes when read back", () => {
  it("returns the summary unchanged when it still qualifies", () => {
    const s = summary();
    expect(summaryFromRow(rowFromSummary(s))).toEqual(s);
  });

  it("round-trips the fields the catalogue card reads", () => {
    const s = summary({ total_score: 99, x402_supported: false, star_count: 7 });
    const served = summaryFromRow(rowFromSummary(s));
    expect(served?.total_score).toBe(99);
    expect(served?.x402_supported).toBe(false);
    expect(served?.star_count).toBe(7);
    expect(served?.category).toBe("yield");
  });
});

describe("a stored row still has to pass the admission gate", () => {
  it("refuses a row with no callable endpoint", () => {
    const s = summary({ a2a_endpoint: null, mcp_server: null });
    expect(summaryFromRow(rowFromSummary(s))).toBeNull();
  });

  it("refuses a row whose only endpoint is private", () => {
    const s = summary({ a2a_endpoint: "http://localhost:8080/" });
    expect(summaryFromRow(rowFromSummary(s))).toBeNull();
  });

  it("refuses a row that lost its category", () => {
    expect(summaryFromRow(rowFromSummary(summary({ category: "general" })))).toBeNull();
  });

  it("refuses a row keyed to a different agent than its payload", () => {
    const mismatched = { ...rowFromSummary(summary()), token_id: "2" };
    expect(summaryFromRow(mismatched)).toBeNull();
  });
});

describe("no database configured", () => {
  it("reports a per-process shelf rather than a shared one", () => {
    expect(shelfStoreMode()).toBe("per-process");
  });

  it("reads nothing and writes nothing without throwing", async () => {
    await expect(loadShelfAgents()).resolves.toEqual([]);
    await expect(loadShelfAgents(97)).resolves.toEqual([]);
    await expect(saveShelfAgents([])).resolves.toBeUndefined();
    await expect(saveShelfAgents([summary()])).resolves.toBeUndefined();
    await expect(deleteShelfAgent(97, "1")).resolves.toBeUndefined();
  });
});
