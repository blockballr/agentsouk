// a featured placement rides above the ranking, so the just-listed strip must
// never repeat the same listing
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { excludeAgents, recentAdmissions, selectFeatured } from "@/lib/agent-index";

const house = "0x84FEDaBd1B83443Ad86796C15619494878B64180";
const stranger = "0x" + "cd".repeat(20);
const now = Date.parse("2026-11-05T18:00:00Z");

function agent(
  tokenId: string,
  options: { chainId?: number; owner?: string; admittedAt?: string } = {},
) {
  const { chainId = 56, owner = stranger, admittedAt } = options;
  return {
    agent_id: `${chainId}:0xreg:${tokenId}`,
    token_id: tokenId,
    chain_id: chainId,
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
    created_at: admittedAt ?? "2026-01-01T00:00:00Z",
    category: "rebalancing",
    categoryScores: {},
    ...(admittedAt ? { admitted_at: admittedAt } : {}),
  } as never;
}

const online = (ids: string[]) =>
  new Map(ids.map((id) => [id, { status: "online" }]));

describe("featured dedup", () => {
  it("drops the featured listing from the just-listed candidates", () => {
    const feature = agent("404603", { owner: house, admittedAt: "2026-11-05T12:00:00Z" });
    const other = agent("376435", { admittedAt: "2026-11-05T11:00:00Z" });
    expect(excludeAgents([feature, other], [feature]).map((a) => a.token_id)).toEqual(["376435"]);
  });

  it("keys identity on chain and token, so the same token id on another chain stays", () => {
    const on56 = agent("404603", { chainId: 56 });
    const on97 = agent("404603", { chainId: 97 });
    expect(excludeAgents([on56, on97], [on56]).map((a) => a.chain_id)).toEqual([97]);
  });

  it("leaves the list untouched when nothing is featured", () => {
    const items = [agent("1"), agent("2")];
    expect(excludeAgents(items, [])).toEqual(items);
  });

  it("excludes the featured agent before the cap, so the strip stays full and disjoint", () => {
    const items = [
      agent("1", { owner: house, admittedAt: "2026-11-05T12:00:00Z" }),
      agent("2", { admittedAt: "2026-11-05T11:00:00Z" }),
      agent("3", { admittedAt: "2026-11-05T10:00:00Z" }),
      agent("4", { admittedAt: "2026-11-05T09:00:00Z" }),
      agent("5", { admittedAt: "2026-11-05T08:00:00Z" }),
    ];
    const verifications = online(["1", "2", "3", "4", "5"]);
    // the placement sees the same mixed set the shelf does, so it can pick one
    const featured = selectFeatured(items, verifications, { houseOperator: house, queryPresent: false });
    const strip = recentAdmissions(excludeAgents(items, featured), verifications, now, 4);
    expect(featured.map((a) => a.token_id)).toEqual(["1"]);
    expect(strip.map((a) => a.token_id)).toEqual(["2", "3", "4", "5"]);
  });
});
