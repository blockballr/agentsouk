// The shelf sells work a hire can execute. A listing the marketplace cannot
// call, which today means a browser page with no A2A or MCP endpoint, is not
// served even when an earlier admission pass let it in, so the rule takes hold
// without waiting for a re-scan.
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  return { state: { rows: [] as unknown[], version: null as string | null } };
});

vi.mock("server-only", () => ({}));
// no request scope here, so after() must not schedule a live top up
vi.mock("next/server", () => ({ after: () => {} }));

vi.mock("../src/lib/shelf-store", () => ({
  deleteShelfAgent: async () => {},
  loadRegistryTotal: async () => null,
  loadShelfAgents: async () => env.state.rows,
  readShelfVersion: async () => env.state.version,
  saveRegistryTotal: async () => {},
  saveShelfAgents: async () => {},
  shelfStoreMode: () => "shared",
  summaryFromRow: (row: unknown) => (row as { payload?: unknown }).payload ?? null,
  readShelfAgents: async () => ({ rows: env.state.rows, ok: true }),
  loadCatalogueMeta: async () => null,
  saveCatalogueMeta: async () => {},
}));

import { canExecute, executableOnly } from "../src/lib/agent-index";
import { queryAgents } from "../src/lib/scanner";

function summary(tokenId: string, endpoint: { a2a?: string; mcp?: string; web?: string }) {
  return {
    agent_id: `97:0x8004:${tokenId}`,
    token_id: tokenId,
    chain_id: 97,
    contract_address: "0x8004",
    owner_address: "0xOwner",
    name: `Agent ${tokenId}`,
    description: "auto compound yield across venues",
    image_url: null,
    is_verified: false,
    star_count: 0,
    x402_supported: true,
    total_score: 10,
    average_score: 1,
    total_feedbacks: 0,
    health_score: null,
    supported_trust_models: [],
    a2a_endpoint: endpoint.a2a ?? null,
    mcp_server: endpoint.mcp ?? null,
    web_endpoint: endpoint.web ?? null,
    is_active: true,
    created_at: "2026-09-27T00:00:00Z",
    category: "yield",
    categoryScores: { yield: 1 },
  };
}

function row(tokenId: string, endpoint: { a2a?: string; mcp?: string; web?: string }) {
  return {
    chain_id: 97,
    token_id: tokenId,
    payload: summary(tokenId, endpoint),
    updated_at: "2026-09-27T00:00:00.000Z",
  };
}

beforeEach(() => {
  env.state.rows = [];
  env.state.version = null;
});

describe("can execute", () => {
  it("reads an A2A or MCP endpoint as executable", () => {
    expect(canExecute({ a2a_endpoint: "https://a.example/x" })).toBe(true);
    expect(canExecute({ mcp_server: "https://m.example/mcp" })).toBe(true);
  });

  it("reads a browser page as reference material, not something a hire can reach", () => {
    expect(canExecute({ web_endpoint: "https://advice.example" })).toBe(false);
    expect(canExecute({ web_endpoint: "https://advice.example", a2a_endpoint: null })).toBe(false);
  });

  it("refuses a private endpoint", () => {
    expect(canExecute({ a2a_endpoint: "http://localhost:8080/" })).toBe(false);
    expect(canExecute({ mcp_server: "http://10.0.0.5/mcp" })).toBe(false);
  });
});

describe("the shelf serves only what a hire can execute", () => {
  it("drops a listing with no callable endpoint and keeps the rest", async () => {
    env.state.rows = [
      row("1", { a2a: "https://a.example/x" }),
      row("2", { web: "https://advice.example" }),
      row("3", { mcp: "https://m.example/mcp" }),
      row("4", { web: "https://content.example/write" }),
    ];

    const { items } = await queryAgents({ limit: 500 });
    const served = new Set(items.map((a) => a.token_id));

    expect(served.has("1")).toBe(true);
    expect(served.has("3")).toBe(true);
    expect(served.has("2")).toBe(false);
    expect(served.has("4")).toBe(false);
    // nothing the shelf serves is an advisory listing, snapshot rows included
    expect(items.every((a) => canExecute(a))).toBe(true);
  });

  it("counts the executable shelf, so a category total cannot promise advisory rows", async () => {
    env.state.rows = [row("1", { a2a: "https://a.example/x" }), row("2", { web: "https://advice.example" })];

    const { items, categoryCounts } = await queryAgents({ limit: 500 });
    const served = new Set(items.map((a) => a.token_id));

    expect(served.has("2")).toBe(false);
    expect(categoryCounts.all).toBe(items.length);
    expect(categoryCounts.yield).toBeGreaterThan(0);
  });

  it("leaves the rule in one place for callers that hold their own list", () => {
    const entries = [
      { token_id: "1", a2a_endpoint: "https://a.example/x" },
      { token_id: "2", web_endpoint: "https://advice.example" },
    ];
    expect(executableOnly(entries).map((e) => e.token_id)).toEqual(["1"]);
  });
});