// The catalogue's freshness: the shared store is the catalogue, the committed
// snapshot is its cold-start seed and its fallback, and the page reports the
// store's own refresh time rather than the committed file's date. No Postgres
// and no network here; the store is mocked and the freshness line is pure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env and the mutable store the mocked shelf-store serves, both hoisted so they
// exist before any module resolves its client or its chain.
const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  return {
    state: {
      rows: [] as unknown[],
      rowsOk: true,
      meta: null as {
        refreshedAt: string;
        registryTotal: number | null;
        shelfSize: number | null;
      } | null,
      saved: [] as unknown[][],
      metaWrites: 0,
      reads: 0,
    },
  };
});

vi.mock("server-only", () => ({}));
// No request scope here, so after() must not schedule a live top up.
vi.mock("next/server", () => ({ after: () => {} }));

vi.mock("../src/lib/shelf-store", () => ({
  deleteShelfAgent: async () => {},
  loadRegistryTotal: async () => null,
  loadShelfAgents: async () => env.state.rows,
  saveRegistryTotal: async () => {},
  saveShelfAgents: async (summaries: unknown[]) => {
    env.state.saved.push(summaries);
  },
  shelfStoreMode: () => "shared",
  summaryFromRow: (row: unknown) =>
    (row as { payload?: unknown }).payload ?? null,
  // A failing read reports ok false, which is what keeps an unavailable database
  // from being mistaken for an empty catalogue.
  readShelfAgents: async () => {
    env.state.reads += 1;
    return { rows: env.state.rows, ok: env.state.rowsOk };
  },
  loadCatalogueMeta: async () => env.state.meta,
  saveCatalogueMeta: async (
    _chainId: number,
    meta: {
      refreshedAt: string;
      registryTotal: number | null;
      shelfSize: number | null;
    },
  ) => {
    env.state.metaWrites += 1;
    env.state.meta = meta;
  },
}));

import { catalogueFreshnessLabel } from "../apps/web/src/pages/MarketplacePage";

function summary(tokenId: string) {
  return {
    agent_id: `97:0x8004:${tokenId}`,
    token_id: tokenId,
    chain_id: 97,
    contract_address: "0x8004",
    owner_address: "0xOwner",
    name: `Yield Agent ${tokenId}`,
    description: "auto compound yield across venues",
    image_url: null,
    is_verified: false,
    star_count: 0,
    x402_supported: true,
    total_score: 1,
    average_score: 1,
    total_feedbacks: 0,
    health_score: null,
    supported_trust_models: [],
    a2a_endpoint: "https://agent.example/x",
    mcp_server: null,
    web_endpoint: null,
    is_active: true,
    created_at: "2026-09-27T00:00:00Z",
    category: "yield",
    categoryScores: { yield: 1 },
  };
}

function row(tokenId: string) {
  return {
    chain_id: 97,
    token_id: tokenId,
    payload: summary(tokenId),
    updated_at: "2026-09-27T00:00:00.000Z",
  };
}

function rawAgent(tokenId: string) {
  return {
    agent_id: `97:0x8004:${tokenId}`,
    token_id: tokenId,
    chain_id: 97,
    contract_address: "0x8004",
    owner_address: "0xOwner",
    name: `Yield Agent ${tokenId}`,
    description: "auto compound yield across venues",
    image_url: null,
    is_verified: false,
    star_count: 0,
    x402_supported: true,
    total_score: 1,
    average_score: 1,
    total_feedbacks: 0,
    health_score: null,
    supported_trust_models: [],
    a2a_endpoint: "https://agent.example/x",
    mcp_server: null,
    web_endpoint: null,
    is_active: true,
    created_at: "2026-09-27T00:00:00Z",
  };
}

// A fresh module instance per test resets the in-memory index and its clocks.
async function freshScanner() {
  vi.resetModules();
  return import("../src/lib/scanner");
}

beforeEach(() => {
  env.state.rows = [];
  env.state.rowsOk = true;
  env.state.meta = null;
  env.state.saved = [];
  env.state.metaWrites = 0;
  env.state.reads = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the freshness line", () => {
  it("uses the snapshot wording when the store has recorded no refresh", () => {
    expect(
      catalogueFreshnessLabel(
        null,
        "2026-09-25T00:00:00Z",
        Date.parse("2026-09-27T00:00:00Z"),
      ),
    ).toBe("snapshot taken 2026-09-25");
  });

  it("uses the store's refresh time when it has one", () => {
    const refreshedAt = "2026-09-27T12:00:00Z";
    expect(
      catalogueFreshnessLabel(
        refreshedAt,
        "2026-09-25T00:00:00Z",
        Date.parse("2026-09-27T12:04:00Z"),
      ),
    ).toBe("catalogue refreshed 4 minutes ago");
  });

  it("reads naturally for one minute, hours and days", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    expect(catalogueFreshnessLabel("2026-09-27T11:59:00Z", null, now)).toBe(
      "catalogue refreshed 1 minute ago",
    );
    expect(catalogueFreshnessLabel("2026-09-27T09:00:00Z", null, now)).toBe(
      "catalogue refreshed 3 hours ago",
    );
    expect(catalogueFreshnessLabel("2026-09-25T12:00:00Z", null, now)).toBe(
      "catalogue refreshed 2 days ago",
    );
  });

  it("does not claim freshness for a future or unparseable time", () => {
    const now = Date.parse("2026-09-27T12:00:00Z");
    // a timestamp ahead of now is clock skew, so it falls back rather than claiming
    expect(
      catalogueFreshnessLabel("2026-09-27T12:05:00Z", "2026-09-25T00:00:00Z", now),
    ).toBe("snapshot taken 2026-09-25");
    expect(
      catalogueFreshnessLabel("not a date", "2026-09-25T00:00:00Z", now),
    ).toBe("snapshot taken 2026-09-25");
    expect(catalogueFreshnessLabel("2026-09-27T12:05:00Z", null, now)).toBeNull();
  });

  it("says nothing when there is neither a refresh time nor a snapshot", () => {
    expect(catalogueFreshnessLabel(null, null, Date.now())).toBeNull();
  });
});

describe("the state the api reports", () => {
  it("keeps the snapshot wording while the store has recorded no refresh", async () => {
    env.state.rows = [];
    env.state.meta = null;
    const { queryAgents } = await freshScanner();

    const result = await queryAgents({ limit: 5 });

    expect(result.indexStatus.catalogueRefreshedAt).toBeNull();
    expect(result.indexStatus.snapshotTime).toBeTruthy();
    expect(
      catalogueFreshnessLabel(
        result.indexStatus.catalogueRefreshedAt,
        result.indexStatus.snapshotTime,
      ),
    ).toBe(`snapshot taken ${result.indexStatus.snapshotTime!.slice(0, 10)}`);
  });

  it("reports the store as the source and its refresh time when it holds rows", async () => {
    const refreshedAt = "2026-09-27T12:00:00Z";
    env.state.rows = [row("row-1")];
    env.state.meta = { refreshedAt, registryTotal: 2462, shelfSize: 21 };
    const { queryAgents } = await freshScanner();

    const result = await queryAgents({ limit: 5 });

    expect(result.indexStatus.catalogueSource).toBe("store");
    expect(result.indexStatus.catalogueRefreshedAt).toBe(refreshedAt);
    expect(
      catalogueFreshnessLabel(
        result.indexStatus.catalogueRefreshedAt,
        null,
        Date.parse("2026-09-27T12:04:00Z"),
      ),
    ).toBe("catalogue refreshed 4 minutes ago");
  });

  it("never empties the shelf or seeds when the store read fails", async () => {
    env.state.rows = [];
    env.state.rowsOk = false;
    const { queryAgents } = await freshScanner();

    const result = await queryAgents({ limit: 100 });

    // the file remains the fallback, and an unavailable database is not empty
    expect(result.items.length).toBeGreaterThan(0);
    expect(env.state.saved).toEqual([]);
    expect(result.indexStatus.catalogueSource).toBe("snapshot");
  });
});

describe("seeding the store from the snapshot", () => {
  it("seeds once when the store is empty and does not repeat", async () => {
    const now = vi.spyOn(Date, "now");
    let clock = 1_000_000_000;
    now.mockImplementation(() => clock);
    const { queryAgents } = await freshScanner();

    await queryAgents({ limit: 5 });
    expect(env.state.saved).toHaveLength(1);
    const seeded = env.state.saved[0] as { chain_id: number }[];
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((a) => a.chain_id === 97)).toBe(true);

    // a later read past the TTL still finds the store empty, so a naive retry
    // would seed again; the once latch must hold
    clock += 31_000;
    await queryAgents({ limit: 5 });
    expect(env.state.saved).toHaveLength(1);
  });
});

describe("reading the store on a TTL", () => {
  it("reads once inside the TTL and again past it", async () => {
    const now = vi.spyOn(Date, "now");
    let clock = 1_000_000_000;
    now.mockImplementation(() => clock);
    const { queryAgents } = await freshScanner();

    await queryAgents({ limit: 5 });
    expect(env.state.reads).toBe(1);

    await queryAgents({ limit: 5 });
    expect(env.state.reads).toBe(1);

    clock += 31_000;
    await queryAgents({ limit: 5 });
    expect(env.state.reads).toBe(2);
  });
});

describe("recording the catalogue's refresh", () => {
  it("writes one meta per successful refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          data: [rawAgent("live-1")],
          meta: { pagination: { page: 1, limit: 100, total: 2462, hasMore: false } },
        }),
      })),
    );
    const { refreshIndexFromLive } = await freshScanner();

    const report = await refreshIndexFromLive(1);

    expect(report.error).toBeNull();
    expect(env.state.metaWrites).toBe(1);
    expect(env.state.meta?.refreshedAt).toBeTruthy();
    expect(env.state.meta?.registryTotal).toBe(2462);
    expect(env.state.meta?.shelfSize).toBeGreaterThan(0);
  });
});
