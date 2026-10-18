// The shelf's default order sells execution: a listing whose card declares the
// ERC-8183 job protocol leads the ones a buyer merely calls, dual-rail cards
// included, and a top up reads the cards of listings that were never read, so
// the split rests on facts the shelf actually holds.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "8453";
  return {
    rows: [] as unknown[],
    saved: [] as unknown[][],
    cardReads: [] as string[],
  };
});

vi.mock("server-only", () => ({}));
// no request scope here, so after() must not schedule a live top up
vi.mock("next/server", () => ({ after: () => {} }));

// a chain with no committed snapshot file, so the shelf is exactly these rows
vi.mock("../src/lib/shelf-store", () => ({
  deleteShelfAgent: async () => {},
  loadCatalogueMeta: async () => null,
  loadRegistryTotal: async () => null,
  loadShelfAgents: async () => env.rows,
  readShelfVersion: async () => "v1",
  saveCatalogueMeta: async () => {},
  saveRegistryTotal: async () => {},
  saveShelfAgents: async (summaries: unknown[]) => {
    env.saved.push(summaries);
  },
  shelfStoreMode: () => "shared",
  summaryFromRow: (row: unknown) => (row as { payload?: unknown }).payload ?? null,
  readShelfAgents: async () => ({ rows: env.rows, ok: true }),
}));

interface TestSkill {
  id: string;
  description?: string;
}

function summary(tokenId: string, skills?: TestSkill[]) {
  return {
    agent_id: `8453:0x8004:${tokenId}`,
    token_id: tokenId,
    chain_id: 8453,
    contract_address: "0x8004",
    owner_address: "0x0000000000000000000000000000000000000001",
    name: `Agent ${tokenId}`,
    description: "compound yield across venues",
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
    a2a_endpoint: `https://agent${tokenId}.example/card`,
    mcp_server: null,
    web_endpoint: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    category: "yield",
    ...(skills ? { skills } : {}),
  };
}

function row(tokenId: string, skills?: TestSkill[]) {
  return {
    chain_id: 8453,
    token_id: tokenId,
    payload: summary(tokenId, skills),
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const JOB_CARD: TestSkill[] = [
  { id: "negotiate-erc8183-job", description: "quote an ERC-8183 job" },
  { id: "notify_funded", description: "start once the job is funded" },
];
// the protocol beside a skill of its own: takes direct tasks too, still executes jobs
const DUAL_CARD: TestSkill[] = [...JOB_CARD, { id: "venus_health", description: "compound on venus" }];
const PLAIN_CARD: TestSkill[] = [{ id: "research", description: "summarise markets" }];

beforeEach(() => {
  env.rows = [];
  env.saved = [];
  env.cardReads = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jobs first", () => {
  it("leads with every card that declares the job protocol, dual-rail included", async () => {
    env.rows = [row("1", DUAL_CARD), row("2", PLAIN_CARD), row("3", JOB_CARD), row("4")];
    vi.resetModules();
    const { queryAgents } = await import("../src/lib/scanner");

    const { items } = await queryAgents({ type: "all", limit: 500, seed: "souk" });
    const pos = (t: string) => items.findIndex((a) => a.token_id === t);

    expect(items).toHaveLength(4);
    expect(pos("1")).toBeGreaterThanOrEqual(0);
    expect(pos("3")).toBeGreaterThanOrEqual(0);
    // both protocol cards lead, whichever order the rotation gives them
    expect(Math.max(pos("1"), pos("3"))).toBeLessThan(Math.min(pos("2"), pos("4")));
  });

  it("keeps the other sorts free of the split", async () => {
    env.rows = [row("1", DUAL_CARD), row("2"), row("3", JOB_CARD), row("4")];
    vi.resetModules();
    const { queryAgents } = await import("../src/lib/scanner");

    const { items } = await queryAgents({ type: "all", metric: "score", limit: 500 });
    expect(items).toHaveLength(4);
  });

  it("reads the card of a listing never read, so the split has its facts", async () => {
    env.rows = [row("1")];
    vi.resetModules();
    const scanner = await import("../src/lib/scanner");
    // the browse seeds the index from the store, as every deployment does
    await scanner.queryAgents({ limit: 500 });

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("8004scan.io")) {
        // this top up admits nothing: capture has to reach an existing listing
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [],
            meta: { pagination: { page: 1, limit: 100, total: 100, hasMore: false } },
          }),
        };
      }
      env.cardReads.push(url);
      return { ok: true, json: async () => ({ skills: JOB_CARD }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await scanner.refreshIndexFromLive();

    expect(env.cardReads).toEqual(["https://agent1.example/card"]);
    const saved = env.saved.flat() as { token_id: string; skills?: unknown[] }[];
    expect(saved.some((s) => s.token_id === "1" && Array.isArray(s.skills))).toBe(true);
    const { items } = await scanner.queryAgents({ limit: 500 });
    expect(items).toHaveLength(1);
    expect(items[0].skills?.map((s) => s.id)).toEqual(["negotiate-erc8183-job", "notify_funded"]);
  });
});
