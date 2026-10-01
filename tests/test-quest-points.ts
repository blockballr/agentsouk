// Set and Earn points come from settled activity alone: each new agent hired earns by the order
// it was hired in, a listing is worth 300, and a finished passport adds a bonus
// a passport is finished by two different agents hired and one listed; a third hire is extra
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
import { FINISH_BONUS, HIRE_POINTS, LISTING_POINTS, passportFinished, questAwards } from "../src/lib/quest-points";
import { GET as progressRoute } from "../src/app/api/quest/progress/route";

const WALLET = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const SELLER = "0x1111111111111111111111111111111111111111";

describe("points", () => {
  it("pays each new agent by the order it was hired in, whatever its category", () => {
    const { points, awards, agentsHired } = questAwards(
      [
        { agent: "97:2237", createdAt: "2026-09-30T10:00:00Z" },
        { agent: "97:2504", createdAt: "2026-09-30T09:00:00Z" },
      ],
      false,
    );
    expect(awards).toEqual([
      { key: "hire-1", points: 100, at: "2026-09-30T09:00:00Z" },
      { key: "hire-2", points: 200, at: "2026-09-30T10:00:00Z" },
    ]);
    expect([points, agentsHired]).toEqual([300, 2]);
  });

  it("counts an agent once, at its first hire", () => {
    const { awards, agentsHired } = questAwards(
      [
        { agent: "97:2237", createdAt: "2026-09-30T12:00:00Z" },
        { agent: "97:2237", createdAt: "2026-09-30T08:00:00Z" },
      ],
      false,
    );
    expect(awards).toEqual([{ key: "hire-1", points: 100, at: "2026-09-30T08:00:00Z" }]);
    expect(agentsHired).toBe(1);
  });

  it("adds the listing, and the bonus only for a finished passport", () => {
    const three = ["97:1", "97:2", "97:3"].map((agent, i) => ({ agent, createdAt: `2026-09-30T0${i}:00:00Z` }));
    expect(questAwards(three.slice(0, 1), true).points).toBe(100 + LISTING_POINTS);
    expect(questAwards(three.slice(0, 2), false).points).toBe(300);
    expect(questAwards(three.slice(0, 2), true).points).toBe(300 + LISTING_POINTS + FINISH_BONUS);
    // the third hire is the extra one, and it is what reaches the full thousand
    expect(questAwards(three, true).points).toBe(1000);
    expect(HIRE_POINTS.reduce((a, b) => a + b, 0) + LISTING_POINTS + FINISH_BONUS).toBe(1000);
  });

  it("pays nothing for a fourth agent, and orders undated hires last", () => {
    const { awards, agentsHired } = questAwards(
      [{ agent: "97:9" }, { agent: "97:1", createdAt: "2026-09-30T05:00:00Z" }, { agent: "97:2", createdAt: "2026-09-30T06:00:00Z" }, { agent: "97:3", createdAt: "2026-09-30T07:00:00Z" }],
      false,
    );
    expect(awards.map((a) => [a.key, a.points])).toEqual([
      ["hire-1", 100],
      ["hire-2", 200],
      ["hire-3", 150],
    ]);
    expect(agentsHired).toBe(4);
  });

  it("finishes a passport at two different agents hired and one listed, and not before", () => {
    expect(passportFinished(2, true)).toBe(true);
    expect(passportFinished(3, true)).toBe(true);
    expect(passportFinished(1, true)).toBe(false);
    expect(passportFinished(2, false)).toBe(false);
  });
});

describe("the quest progress route", () => {
  const HEALTH = { chain_id: 97, token_id: "2504", name: "Souk Health Guard", category: "health-factor", owner_address: SELLER };
  const YIELD = { chain_id: 97, token_id: "2237", name: "Sluicegate", category: "yield", owner_address: SELLER };
  const KEEL = { chain_id: 97, token_id: "2238", name: "Keel", category: "health-factor", owner_address: SELLER };
  const GRID = { chain_id: 97, token_id: "2522", name: "Souk Grid Planner", category: "grid-trading", owner_address: SELLER };
  const MINE = { chain_id: 97, token_id: "3001", name: "My Agent", category: "yield", owner_address: WALLET };

  beforeEach(() => {
    store.payments = [];
    store.agents = [HEALTH, YIELD];
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
    expect(body.points).toBe(300);
    expect(body.awards.map((a: { key: string }) => a.key)).toEqual(["hire-1", "hire-2"]);
  });

  it("is complete once two different agents are hired and one is listed", async () => {
    store.agents = [HEALTH, YIELD, MINE];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z")];
    const one = await progress();
    expect([one.agentsHired, one.requiredHires, one.completed]).toEqual([1, 2, false]);

    store.payments = [payment("2504", "2026-09-30T09:00:00Z"), payment("2237", "2026-09-30T10:00:00Z")];
    const two = await progress();
    expect([two.agentsHired, two.completed]).toEqual([2, true]);
    expect(two.points).toBe(100 + 200 + LISTING_POINTS + FINISH_BONUS);
    expect(two.awards.map((a: { key: string }) => a.key)).toEqual(["hire-1", "hire-2", "listing", "bonus"]);
  });

  it("pays the third hire as an extra, on top of a finished passport", async () => {
    store.agents = [HEALTH, YIELD, GRID, MINE];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z"), payment("2237", "2026-09-30T10:00:00Z"), payment("2522", "2026-09-30T11:00:00Z")];
    const body = await progress();
    expect([body.agentsHired, body.completed, body.points]).toEqual([3, true, 1000]);
  });

  it("does not count the same agent hired twice as two hires", async () => {
    store.agents = [HEALTH, MINE];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z"), payment("2504", "2026-09-30T11:00:00Z")];
    const body = await progress();
    expect([body.agentsHired, body.completed]).toEqual([1, false]);
  });

  it("counts two agents of one category as two hires", async () => {
    store.agents = [HEALTH, KEEL, MINE];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z"), payment("2238", "2026-09-30T10:00:00Z")];
    const body = await progress();
    expect([body.agentsHired, body.completed]).toEqual([2, true]);
  });

  it("says whether the wallet is one of ours, since ours never earn a stamp", async () => {
    expect((await progress()).team).toBe(false);
  });

  it("keeps the stamp and the points of a hire that was later revoked", async () => {
    store.payments = [payment("2504", "2026-09-30T09:00:00Z", { activated: false })];
    const body = await progress();
    expect(body.points).toBe(100);
    expect(body.agentsHired).toBe(1);
    expect(body.categories["health-factor"]).toBe(true);
  });

  it("keeps the stamp of a hire whose agent has since left the shelf", async () => {
    store.agents = [{ ...HEALTH, offShelf: true }];
    store.payments = [payment("2504", "2026-09-30T09:00:00Z")];
    const body = await progress();
    expect([body.agentsHired, body.points]).toEqual([1, 100]);
  });

  it("keeps the listing stamp once the wallet's own agent has left the shelf", async () => {
    store.agents = [{ ...MINE, offShelf: true }];
    const body = await progress();
    expect(body.listedOne).toBe(true);
    expect(body.listings).toEqual([{ tokenId: "3001", name: "My Agent", category: "yield" }]);
    expect(body.points).toBe(LISTING_POINTS);
  });

  it("still leaves out a sandbox receipt, the verifier's checks and a hire of one's own agent", async () => {
    store.agents = [HEALTH, MINE];
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
