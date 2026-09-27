// Pins the pure half of the self-healing shelf: when a refresh is due, which
// live entries are worth taking, and how a registry record collapses to the
// summary the shelf stores. No network, because these are the decisions the
// scanner delegates to agent-index.
import { describe, expect, it } from "vitest";
import {
  dueForRefresh,
  indexKey,
  isShelfReady,
  shouldCacheShelfAgent,
  summaryFromDetail,
} from "../src/lib/agent-index";
import {
  BSC_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  snapshotFileFor,
} from "../src/lib/types";
import type { AgentDetail } from "../src/lib/types";

const COOLDOWN_MS = 60_000;

function detail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "rec-1",
    agent_id: "56:0x8004:1",
    token_id: "1",
    chain_id: BSC_CHAIN_ID,
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

// The shelf tops up on a cooldown, so the boundary decides how often browse
// traffic can reach the registry in a cold-heartbeat process.
describe("refresh cooldown", () => {
  it("is due the first time the shelf is asked", () => {
    expect(dueForRefresh(null, 1_000, COOLDOWN_MS)).toBe(true);
  });

  it("holds inside the cooldown window", () => {
    expect(dueForRefresh(1_000, 30_000, COOLDOWN_MS)).toBe(false);
  });

  it("does not fire one millisecond before the boundary", () => {
    expect(dueForRefresh(1_000, 1_000 + COOLDOWN_MS - 1, COOLDOWN_MS)).toBe(false);
  });

  // The comparison is >=, so exactly one cooldown later a refresh is allowed.
  it("fires exactly at the cooldown boundary", () => {
    expect(dueForRefresh(1_000, 1_000 + COOLDOWN_MS, COOLDOWN_MS)).toBe(true);
  });

  it("fires well past the boundary", () => {
    expect(dueForRefresh(1_000, 1_000 + COOLDOWN_MS * 5, COOLDOWN_MS)).toBe(true);
  });

  it("treats a zero cooldown as always due once the shelf has refreshed", () => {
    expect(dueForRefresh(1_000, 1_000, 0)).toBe(true);
  });
});

// A refresh keeps only entries that pass the gate; this is the admission
// decision applied per live entry.
describe("entries worth taking from a live page", () => {
  it("refuses an entry with no endpoint", () => {
    expect(isShelfReady({ category: "yield" })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: null, mcp_server: null, category: "yield" })).toBe(false);
  });

  it("refuses an entry whose only endpoint is private", () => {
    expect(isShelfReady({ a2a_endpoint: "http://localhost:8080/", category: "yield" })).toBe(false);
    expect(isShelfReady({ mcp_server: "http://127.0.0.1:3000/mcp", category: "rebalancing" })).toBe(
      false,
    );
    expect(isShelfReady({ mcp_server: "http://10.0.0.5/mcp", category: "yield" })).toBe(false);
  });

  it("admits an entry with a public endpoint and a real category", () => {
    expect(isShelfReady({ a2a_endpoint: "https://agent.example/x", category: "yield" })).toBe(true);
    expect(isShelfReady({ mcp_server: "https://m.example/mcp", category: "grid-trading" })).toBe(
      true,
    );
  });

  it("refuses an entry with no category even when its endpoint is public", () => {
    expect(isShelfReady({ a2a_endpoint: "https://agent.example/x", category: "general" })).toBe(
      false,
    );
    expect(isShelfReady({ a2a_endpoint: "https://agent.example/x", category: null })).toBe(false);
    expect(isShelfReady({ a2a_endpoint: "https://agent.example/x" })).toBe(false);
  });

  it("admits an entry whose public endpoint sits beside a private one", () => {
    expect(
      isShelfReady({
        a2a_endpoint: "http://localhost:8080/",
        mcp_server: "https://m.example/mcp",
        category: "health-factor",
      }),
    ).toBe(true);
  });
});

// A live detail read builds a summary and only shelves it when it qualifies, so
// the summary's endpoint and category are what freshness hinges on.
describe("summary shape and its admission consequence", () => {
  it("keeps an absent endpoint null and refuses the summary", () => {
    const summary = summaryFromDetail(detail({ a2a_endpoint: null, mcp_server: null }));
    expect(summary.a2a_endpoint).toBeNull();
    expect(summary.mcp_server).toBeNull();
    expect(isShelfReady(summary)).toBe(false);
  });

  it("carries a private endpoint through and refuses the summary", () => {
    const summary = summaryFromDetail(detail({ a2a_endpoint: "http://localhost:8080/" }));
    expect(summary.a2a_endpoint).toBe("http://localhost:8080/");
    expect(isShelfReady(summary)).toBe(false);
  });

  it("carries a public endpoint through and admits the summary", () => {
    const summary = summaryFromDetail(
      detail({ a2a_endpoint: "https://agent.example/.well-known/agent-card.json" }),
    );
    expect(summary.a2a_endpoint).toBe("https://agent.example/.well-known/agent-card.json");
    expect(isShelfReady(summary)).toBe(true);
  });

  it("lands a record with no category signal in general and refuses it despite a public endpoint", () => {
    const summary = summaryFromDetail(
      detail({
        name: "Helper",
        description: "a general purpose assistant",
        a2a_endpoint: "https://agent.example/x",
      }),
    );
    expect(summary.category).toBe("general");
    expect(isShelfReady(summary)).toBe(false);
  });
});

// The index is shared across chains, so a live detail read only feeds the shelf
// of the chain it was read for.
describe("chain scoping of a live detail cache", () => {
  it("caches the target chain", () => {
    expect(shouldCacheShelfAgent(BSC_CHAIN_ID, BSC_CHAIN_ID)).toBe(true);
  });

  it("refuses to cache a foreign chain into a single-chain shelf", () => {
    expect(shouldCacheShelfAgent(BSC_TESTNET_CHAIN_ID, BSC_CHAIN_ID)).toBe(false);
  });

  it("keys the same token apart across chains", () => {
    expect(indexKey(BSC_CHAIN_ID, "1")).not.toBe(indexKey(BSC_TESTNET_CHAIN_ID, "1"));
  });
});

// The snapshot is read per target chain, which is the read side of the build
// route mismatch on testnet.
describe("snapshot file per chain", () => {
  it("reads agents.json on BSC mainnet", () => {
    expect(snapshotFileFor(BSC_CHAIN_ID)).toBe("agents.json");
  });

  it("reads agents-97.json on BSC testnet", () => {
    expect(snapshotFileFor(BSC_TESTNET_CHAIN_ID)).toBe("agents-97.json");
  });
});
