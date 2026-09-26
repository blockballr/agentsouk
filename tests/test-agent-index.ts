import { describe, expect, it } from "vitest";
import {
  dueForRefresh,
  isShelfReady,
  indexKey,
  shouldCacheShelfAgent,
  summaryFromDetail,
} from "../src/lib/agent-index";
import type { AgentDetail } from "../src/lib/types";

function detail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "rec-1",
    agent_id: "56:0x8004:1",
    token_id: "1",
    chain_id: 56,
    contract_address: "0x8004",
    owner_address: "0xOwner",
    creator_address: "0xOwner",
    name: "Yield Bot",
    description: "auto compound yield across venues",
    agent_wallet: null,
    x402_supported: true,
    image_url: null,
    is_verified: false,
    is_active: true,
    supported_trust_models: ["reputation"],
    services: null,
    a2a_endpoint: null,
    mcp_server: null,
    agent_url: null,
    total_feedbacks: 3,
    total_validations: 0,
    successful_validations: 0,
    average_score: 4,
    total_score: 12,
    health_score: null,
    health_status: null,
    quality_score: 0,
    popularity_score: 0,
    activity_score: 0,
    wallet_score: 0,
    freshness_score: 0,
    metadata_completeness_score: 0,
    created_block_number: null,
    created_tx_hash: null,
    is_endpoint_verified: false,
    endpoint_verified_domain: null,
    raw_metadata: null,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
    ...overrides,
  };
}

// The index singleton is shared across chains, so a key that drops the chain
// would let a chain-97 record shadow the chain-56 agent with the same token.
describe("indexKey", () => {
  it("separates the same token on different chains", () => {
    expect(indexKey(56, "1")).not.toBe(indexKey(97, "1"));
  });

  it("is stable for the same chain and token", () => {
    expect(indexKey(56, "358942")).toBe("56:358942");
  });
});

describe("summaryFromDetail", () => {
  it("classifies a registry record so it can sit on the shelf", () => {
    const summary = summaryFromDetail(detail());
    expect(summary.category).toBe("yield");
    expect(summary.categoryScores?.yield).toBeGreaterThanOrEqual(2);
  });

  it("maps the fields the catalogue card reads", () => {
    const summary = summaryFromDetail(detail({ x402_supported: true, total_score: 12 }));
    expect(summary.agent_id).toBe("56:0x8004:1");
    expect(summary.token_id).toBe("1");
    expect(summary.chain_id).toBe(56);
    expect(summary.total_score).toBe(12);
    expect(summary.x402_supported).toBe(true);
    expect(summary.star_count).toBe(0);
  });

  it("lands a generic registration in general rather than a specialist bucket", () => {
    const summary = summaryFromDetail(
      detail({ name: "Helper", description: "a general purpose assistant" }),
    );
    expect(summary.category).toBe("general");
  });

  it("carries verification through when the record has one", () => {
    const summary = summaryFromDetail(
      detail({
        verification: { status: "delivered", responseMs: 10, checkedAt: "2026-09-26T01:00:00Z" },
      }),
    );
    expect(summary.verification?.status).toBe("delivered");
  });
});

describe("shouldCacheShelfAgent", () => {
  it("caches the target chain", () => {
    expect(shouldCacheShelfAgent(56, 56)).toBe(true);
  });

  it("refuses to cache a foreign chain into a single-chain shelf", () => {
    expect(shouldCacheShelfAgent(97, 56)).toBe(false);
  });
});

describe("dueForRefresh", () => {
  it("is due when the process has never refreshed", () => {
    expect(dueForRefresh(null, 1_000, 60_000)).toBe(true);
  });

  it("holds off inside the cooldown", () => {
    expect(dueForRefresh(1_000, 30_000, 60_000)).toBe(false);
  });

  it("is due once the cooldown has passed", () => {
    expect(dueForRefresh(1_000, 61_000, 60_000)).toBe(true);
  });
});

describe("shelf admission", () => {
  // The registry admits anything registered, so a wholesale index put 100 extra agents on the
  // shelf, 30 unclassified and 39 uncallable; the brief grades against both
  it("admits an agent with a callable endpoint and a real category", () => {
    expect(isShelfReady({ a2a_endpoint: "https://a.example/x", category: "yield" })).toBe(true);
    expect(isShelfReady({ mcp_server: "https://m.example/mcp", category: "rebalancing" })).toBe(true);
  });

  it("refuses an agent with no callable endpoint", () => {
    expect(isShelfReady({ category: "yield" })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: null, mcp_server: null, category: "yield" })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: "", category: "yield" })).toBe(false);
  });

  it("refuses an unclassified agent even when callable", () => {
    expect(isShelfReady({ a2a_endpoint: "https://a.example/x", category: "general" })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: "https://a.example/x", category: null })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: "https://a.example/x" })).toBe(false);
  });

  it("refuses an agent that fails both", () => {
    expect(isShelfReady({})).toBe(false);
  });
});
