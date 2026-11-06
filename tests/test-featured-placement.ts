// the featured slot is one agent we operate, disclosed, and only while it fits
// the current filters; it never reorders the ranking
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { selectFeatured } from "@/lib/agent-index";

const house = "0x84FEDaBd1B83443Ad86796C15619494878B64180";

function agent(tokenId: string, owner: string, admittedAt?: string) {
  return {
    agent_id: `56:0xreg:${tokenId}`,
    token_id: tokenId,
    chain_id: 56,
    contract_address: "0x" + "11".repeat(20),
    owner_address: owner,
    name: `agent ${tokenId}`,
    description: "",
    image_url: null,
    is_verified: false,
    star_count: 0,
    x402_supported: false,
    total_score: 0,
    average_score: 0,
    total_feedbacks: 0,
    health_score: null,
    supported_trust_models: [],
    a2a_endpoint: "https://example.test/a2a",
    mcp_server: null,
    web_endpoint: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    category: "rebalancing",
    categoryScores: {},
    ...(admittedAt ? { admitted_at: admittedAt } : {}),
  } as never;
}

const online = (ids: string[]) => new Map(ids.map((id) => [id, { status: "online" }]));
const stranger = "0x" + "cd".repeat(20);

describe("featured placement", () => {
  it("picks one first-party agent that answered a probe, newest first", () => {
    const items = [
      agent("1", house, "2026-11-04T00:00:00Z"),
      agent("2", house, "2026-11-05T12:00:00Z"),
      agent("3", stranger, "2026-11-05T13:00:00Z"),
    ];
    const picked = selectFeatured(items, online(["1", "2", "3"]), { houseOperator: house, queryPresent: false });
    expect(picked.map((a) => a.token_id)).toEqual(["2"]);
  });

  it("shows nothing while a search query is active", () => {
    const items = [agent("1", house, "2026-11-05T12:00:00Z")];
    expect(selectFeatured(items, online(["1"]), { houseOperator: house, queryPresent: true })).toHaveLength(0);
  });

  it("ignores first-party agents with no passing probe", () => {
    const items = [agent("1", house, "2026-11-05T12:00:00Z")];
    expect(selectFeatured(items, new Map([["1", { status: "dead" }]]), { houseOperator: house, queryPresent: false })).toHaveLength(0);
  });

  it("never features a third-party agent", () => {
    const items = [agent("1", stranger, "2026-11-05T12:00:00Z")];
    expect(selectFeatured(items, online(["1"]), { houseOperator: house, queryPresent: false })).toHaveLength(0);
  });

  it("shows nothing on a rail where every listing is ours", () => {
    // the vault rail is house only today, so a placement would separate nothing
    const items = [
      agent("1", house, "2026-11-04T00:00:00Z"),
      agent("2", house, "2026-11-05T12:00:00Z"),
    ];
    expect(selectFeatured(items, online(["1", "2"]), { houseOperator: house, queryPresent: false })).toHaveLength(0);
  });

  it("still features a house agent while the set is mixed", () => {
    const items = [
      agent("1", house, "2026-11-05T12:00:00Z"),
      agent("2", stranger, "2026-11-05T13:00:00Z"),
    ];
    const picked = selectFeatured(items, online(["1", "2"]), { houseOperator: house, queryPresent: false });
    expect(picked.map((a) => a.token_id)).toEqual(["1"]);
  });
});
