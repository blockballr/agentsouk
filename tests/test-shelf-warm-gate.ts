// warming gates on shelf size, never on whether a snapshot file exists: a store-filled shelf would fetch the registry every browse
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// no request scope here, so after() must not schedule a live top up
vi.mock("next/server", () => ({ after: () => {} }));

// a chain with no committed snapshot file, so the shelf starts from the store alone
const CHAIN = 8453;

const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  return { rows: [] as unknown[] };
});

vi.mock("../src/lib/shelf-store", () => ({
  deleteShelfAgent: async () => {},
  loadCatalogueMeta: async () => null,
  loadRegistryTotal: async () => null,
  loadShelfAgents: async () => env.rows,
  readShelfAgent: async () => null,
  readShelfAgents: async () => ({ rows: env.rows, ok: true }),
  readShelfVersion: async () => "v1",
  saveCatalogueMeta: async () => {},
  saveRegistryTotal: async () => {},
  saveShelfAgents: async () => {},
  shelfStoreMode: () => "shared",
  summaryFromRow: (row: unknown) => (row as { payload?: unknown }).payload ?? null,
}));

function row(n: number) {
  return {
    chain_id: CHAIN,
    token_id: String(n),
    payload: {
      agent_id: `8453:${n}`,
      token_id: String(n),
      chain_id: CHAIN,
      contract_address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      owner_address: "0x0000000000000000000000000000000000000001",
      name: `Agent ${n}`,
      description: "yield",
      image_url: null,
      is_verified: false,
      star_count: 0,
      x402_supported: true,
      total_score: 1,
      average_score: 1,
      total_feedbacks: 0,
      health_score: null,
      supported_trust_models: [],
      supported_protocols: ["A2A"],
      a2a_endpoint: `https://agent${n}.example/x`,
      mcp_server: null,
      web_endpoint: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      category: "yield",
    },
  };
}

// any registry read during queryAgents is warming, since the top up goes through after()
function registryStub() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      data: [],
      meta: { pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  env.rows = [];
  process.env.TARGET_CHAIN = String(CHAIN);
});

afterEach(() => {
  delete process.env.TARGET_CHAIN;
  vi.unstubAllGlobals();
});

describe("the warm gate", () => {
  it("warms an empty shelf that was asked to be warm", async () => {
    const fetchMock = registryStub();
    vi.resetModules();
    const { queryAgents } = await import("../src/lib/scanner");

    await queryAgents({ ensureWarm: true, limit: 1 });

    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not warm a shelf the store already filled, because the file's absence is not the signal", async () => {
    env.rows = Array.from({ length: 30 }, (_, i) => row(i + 1));
    const fetchMock = registryStub();
    vi.resetModules();
    const { queryAgents } = await import("../src/lib/scanner");

    await queryAgents({ ensureWarm: true, limit: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warms a shelf still too small to fill a page", async () => {
    env.rows = Array.from({ length: 3 }, (_, i) => row(i + 1));
    const fetchMock = registryStub();
    vi.resetModules();
    const { queryAgents } = await import("../src/lib/scanner");

    await queryAgents({ ensureWarm: true, limit: 1 });

    expect(fetchMock).toHaveBeenCalled();
  });
});
