// Set and Earn points come from settled activity alone: a listing is worth 300, each category's
// first hire earns by the order the categories were reached, and the full set adds a bonus
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  return { payments: [] as unknown[], agents: [] as { offShelf?: boolean }[] };
});

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/receipts-store", () => ({
  listPaymentsByClient: async () => store.payments,
  receiptsMode: () => "memory",
}));
// like the real catalogue, an agent that is off the shelf is only returned when asked for
vi.mock("../src/lib/scanner", () => ({
  queryAgents: async (opts: { includeDelisted?: boolean; includeHouse?: boolean } = {}) => {
    const items = store.agents.filter((a) => !a.offShelf || (opts.includeDelisted && opts.includeHouse));
    return { items, total: items.length };
  },
}));

import { NextRequest } from "next/server";
import { CATEGORY_KEYS } from "@agora/core";
import { FINISH_BONUS, LISTING_POINTS, questAwards } from "../src/lib/quest-points";
import { GET as progressRoute } from "../src/app/api/quest/progress/route";

const WALLET = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const SELLER = "0x1111111111111111111111111111111111111111";

describe("points", () => {
  it("pays hires by the order the categories were reached, not by which category", () => {
    const { points, awards } = questAwards(
      [
        { category: "yield", createdAt: "2026-09-30T10:00:00Z" },
        { category: "health-factor", createdAt: "2026-09-30T09:00:00Z" },
      ],
      CATEGORY_KEYS,
      false,
    );
    expect(awards).toEqual([
      { key: "health-factor", points: 100, at: "2026-09-30T09:00:00Z" },
      { key: "yield", points: 150, at: "2026-09-30T10:00:00Z" },
    ]);
    expect(points).toBe(250);
  });

  it("counts a category once, at its first hire", () => {
    const { awards } = questAwards(
      [
        { category: "yield", createdAt: "2026-09-30T12:00:00Z" },
        { category: "yield", createdAt: "2026-09-30T08:00:00Z" },
      ],
      CATEGORY_KEYS,
      false,
    );
    expect(awards).toEqual([{ key: "yield", points: 100, at: "2026-09-30T08:00:00Z" }]);
  });

  it("adds the listing, and the bonus only for the full set", () => {
    const four = CATEGORY_KEYS.map((c, i) => ({ category: c, createdAt: `2026-09-30T0${i}:00:00Z` }));
    expect(questAwards(four.slice(0, 3), CATEGORY_KEYS, true).points).toBe(100 + 150 + 100 + LISTING_POINTS);
    expect(questAwards(four, CATEGORY_KEYS, false).points).toBe(450);
    expect(questAwards(four, CATEGORY_KEYS, true).points).toBe(450 + LISTING_POINTS + FINISH_BONUS);
    expect(questAwards(four, CATEGORY_KEYS, true).points).toBe(1000);
  });

  it("ignores hires outside the four categories and orders undated ones last", () => {
    const { awards } = questAwards(
      [
        { category: "general", createdAt: "2026-09-30T01:00:00Z" },
        { category: null },
        { category: "rebalancing" },
        { category: "grid-trading", createdAt: "2026-09-30T05:00:00Z" },
      ],
      CATEGORY_KEYS,
      false,
    );
    expect(awards.map((a) => [a.key, a.points])).toEqual([
      ["grid-trading", 100],
      ["rebalancing", 150],
    ]);
  });
});

describe("the quest progress route", () => {
  beforeEach(() => {
    store.payments = [];
    store.agents = [
      { chain_id: 97, token_id: "2504", name: "Souk Health Guard", category: "health-factor", owner_address: SELLER },
      { chain_id: 97, token_id: "2237", name: "Sluicegate", category: "yield", owner_address: SELLER },
    ];
  });

  function payment(tokenId: string, at: string, extra: Record<string, unknown> = {}) {
    return {
      paymentId: `pay_${tokenId}_${at}`,
      activated: true,
      mode: "prod",
      agent: { chainId: 97, tokenId, name: `agent ${tokenId}` },
      txHash: "0xab",
      createdAt: at,
      ...extra,
    };
  }

  async function progress() {
    const res = await progressRoute(new NextRequest(`https://api.agentsouk.xyz/api/quest/progress?wallet=${WALLET}`));
    return res.json();
  }

  it("returns the points the settled hires earn", async () => {
    store.payments = [payment("2237", "2026-09-30T10:00:00Z"), payment("2504", "2026-09-30T09:00:00Z")];
    const body = await progress();
    expect(body.points).toBe(250);
    expect(body.awards.map((a: { key: string }) => a.key)).toEqual(["health-factor", "yield"]);
  });

  it("keeps the stamp and the points of a hire that was later revoked", async () => {
    store.payments = [payment("2504", "2026-09-30T09:00:00Z", { activated: false })];
    const body = await progress();
    expect(body.points).toBe(100);
    expect(body.categories["health-factor"]).toBe(true);
    expect(body.awards.map((a: { key: string }) => a.key)).toEqual(["health-factor"]);
  });

  it("keeps the stamp of a hire whose agent has since left the shelf", async () => {
    store.agents = [
      { chain_id: 97, token_id: "2504", name: "Souk Health Guard", category: "health-factor", owner_address: SELLER, offShelf: true },
    ];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z")];
    const body = await progress();
    expect(body.categories["health-factor"]).toBe(true);
    expect(body.points).toBe(100);
  });

  it("keeps the listing stamp once the wallet's own agent has left the shelf", async () => {
    store.agents = [
      { chain_id: 97, token_id: "3001", name: "My Agent", category: "yield", owner_address: WALLET, offShelf: true },
    ];
    const body = await progress();
    expect(body.listedOne).toBe(true);
    expect(body.listings).toEqual([{ tokenId: "3001", name: "My Agent", category: "yield" }]);
    expect(body.points).toBe(LISTING_POINTS);
  });

  it("still leaves out a sandbox receipt, the verifier's checks and a hire of one's own agent", async () => {
    store.agents = [
      { chain_id: 97, token_id: "2504", name: "Souk Health Guard", category: "health-factor", owner_address: SELLER },
      { chain_id: 97, token_id: "3001", name: "My Agent", category: "yield", owner_address: WALLET },
    ];
    store.payments = [
      payment("2504", "2026-09-30T09:00:00Z", { mode: "sandbox" }),
      payment("2504", "2026-09-30T09:05:00Z", { paymentId: "verify_abc123def456" }),
      payment("3001", "2026-09-30T09:10:00Z"),
    ];
    const body = await progress();
    expect(body.hires).toEqual([]);
    expect(body.points).toBe(LISTING_POINTS);
  });
});
