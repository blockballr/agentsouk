// the strip is bounded exposure: recent admissions that answered a probe, newest first
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JUST_LISTED_WINDOW_MS, recentAdmissions } from "@/lib/agent-index";

const now = Date.parse("2026-11-05T18:00:00Z");

function agent(tokenId: string, admittedAt?: string) {
  return {
    agent_id: `56:0xreg:${tokenId}`,
    token_id: tokenId,
    chain_id: 56,
    contract_address: "0x" + "11".repeat(20),
    owner_address: "0x" + "22".repeat(20),
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

describe("just listed strip", () => {
  it("keeps only recent admissions whose probe answered, newest first", () => {
    const items = [
      agent("1", "2026-11-04T00:00:00Z"),
      agent("2", "2026-11-05T12:00:00Z"),
      agent("3", "2026-11-05T10:00:00Z"),
    ];
    const picked = recentAdmissions(items, online(["1", "2", "3"]), now, 4);
    expect(picked.map((a) => a.token_id)).toEqual(["2", "3", "1"]);
  });

  it("drops old admissions, missing admission times and unprobed agents", () => {
    const items = [
      agent("1", "2026-10-01T00:00:00Z"),
      agent("2"),
      agent("3", "2026-11-05T12:00:00Z"),
    ];
    const verifications = new Map([
      ["3", { status: "dead" }],
    ]);
    expect(recentAdmissions(items, verifications, now, 4)).toHaveLength(0);
  });

  it("caps at the limit and accepts delivered as well as online", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      agent(String(i), new Date(now - i * 60_000).toISOString()),
    );
    const verifications = new Map(items.map((a) => [a.token_id, { status: "delivered" }]));
    const picked = recentAdmissions(items, verifications, now, 3);
    expect(picked).toHaveLength(3);
    expect(now - Date.parse((picked[0] as { admitted_at: string }).admitted_at)).toBeLessThan(JUST_LISTED_WINDOW_MS);
  });
});
