// the shelf health panel, proved without a database: three states of one clock
import { beforeEach, describe, expect, it, vi } from "vitest";

delete process.env.DATABASE_URL;

vi.mock("server-only", () => ({}));

const scanner = vi.hoisted(() => ({
  queryAgents: vi.fn(async () => ({ items: [] as Record<string, unknown>[] })),
}));
vi.mock("@/lib/scanner", () => scanner);

const verificationsStore = vi.hoisted(() => ({
  // the real window, so the countdown arithmetic runs against the shipped clock
  loadStaleTokens: vi.fn(async () => [] as Record<string, unknown>[]),
  DELIST_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock("@/lib/verifications-store", () => verificationsStore);

const verifications = vi.hoisted(() => ({ loadVerifications: vi.fn(async () => new Map()) }));
vi.mock("@/lib/verifications", () => verifications);

const delist = vi.hoisted(() => ({ loadDelistedRows: vi.fn(async () => new Map()) }));
vi.mock("@/lib/delist-store", () => delist);

const boosts = vi.hoisted(() => ({ hydrateBoostsFromDb: vi.fn(async () => {}), isBoosted: vi.fn(() => false) }));
vi.mock("@/lib/boosts", () => boosts);

const shelf = vi.hoisted(() => ({ loadShelfAgents: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/lib/shelf-store", () => shelf);

const team = vi.hoisted(() => ({ TEAM_WALLETS: [] as string[], isTeamWallet: vi.fn(() => false) }));
vi.mock("@/lib/team-wallets", () => team);

import { stationShelfHealth } from "../src/lib/station-data";

const DAY = 24 * 60 * 60 * 1000;
const OWNER = "0x1111111111111111111111111111111111111111";

function item(tokenId: string, name: string, category = "yield") {
  return { token_id: tokenId, name, category, owner_address: OWNER };
}

function delistedRow(reason: string, at: string) {
  return { reason, delistedAt: at };
}

async function health(now = Date.now()) {
  return stationShelfHealth(now);
}

// module-level mocks, so every test starts from an empty shelf
beforeEach(() => {
  scanner.queryAgents.mockResolvedValue({ items: [] });
  verifications.loadVerifications.mockResolvedValue(new Map());
  verificationsStore.loadStaleTokens.mockResolvedValue([]);
  delist.loadDelistedRows.mockResolvedValue(new Map());
  shelf.loadShelfAgents.mockResolvedValue([]);
});

describe("station shelf health", () => {
  it("counts what holds, what fails toward the clock, and what already left", async () => {
    const now = Date.now();
    scanner.queryAgents.mockResolvedValue({
      items: [
        item("1", "Answers Fine"),
        item("2", "Dead Three Days"),
        item("3", "Dead Five Days"),
        item("4", "Gone Two Days"),
      ],
    });
    verifications.loadVerifications.mockResolvedValue(
      new Map([
        ["1", { status: "online", checkedAt: new Date(now).toISOString(), detail: null }],
        ["2", { status: "dead", checkedAt: new Date(now - DAY).toISOString(), detail: "no answer" }],
        ["3", { status: "unreachable", checkedAt: new Date(now - DAY).toISOString(), detail: "timeout" }],
      ]),
    );
    verificationsStore.loadStaleTokens.mockResolvedValue([
      { tokenId: "2", name: "Dead Three Days", category: "yield", status: "dead", failingSince: new Date(now - 3 * DAY).toISOString() },
      { tokenId: "3", name: "Dead Five Days", category: "yield", status: "unreachable", failingSince: new Date(now - 5 * DAY).toISOString() },
    ]);
    delist.loadDelistedRows.mockResolvedValue(new Map([["4", delistedRow("auto-stale", new Date(now - 2 * DAY).toISOString())]]));
    // the store holds the four board rows plus one the endpoint gate hides
    shelf.loadShelfAgents.mockResolvedValue([{}, {}, {}, {}, {}]);

    const h = await health(now);

    expect(h.chainId).toBe(56);
    expect(h.windowDays).toBe(7);
    expect(h.onShelf).toEqual({ total: 3, answering: 1 });
    expect(h.failing.map((f) => [f.tokenId, f.daysLeft])).toEqual([
      ["3", 2],
      ["2", 4],
    ]);
    expect(h.delisted.map((d) => [d.tokenId, d.daysOff, d.delisted?.reason])).toEqual([
      ["4", 2, "auto-stale"],
    ]);
    expect(h.neverEligible).toBe(1);
  });

  it("reads an empty shelf as empty everywhere", async () => {
    const h = await health();
    expect(h.onShelf).toEqual({ total: 0, answering: 0 });
    expect(h.failing).toEqual([]);
    expect(h.delisted).toEqual([]);
    expect(h.neverEligible).toBe(0);
  });

  it("keeps a delisted agent out of the failing countdown even while it fails", async () => {
    const now = Date.now();
    scanner.queryAgents.mockResolvedValue({ items: [item("9", "Failing And Gone")] });
    verifications.loadVerifications.mockResolvedValue(
      new Map([["9", { status: "dead", checkedAt: new Date(now).toISOString(), detail: null }]]),
    );
    verificationsStore.loadStaleTokens.mockResolvedValue([
      { tokenId: "9", name: "Failing And Gone", category: "yield", status: "dead", failingSince: new Date(now - 2 * DAY).toISOString() },
    ]);
    delist.loadDelistedRows.mockResolvedValue(new Map([["9", delistedRow("manual", new Date(now - DAY).toISOString())]]));
    shelf.loadShelfAgents.mockResolvedValue([{}]);

    const h = await health(now);

    expect(h.failing).toEqual([]);
    expect(h.delisted).toHaveLength(1);
    expect(h.onShelf.total).toBe(0);
  });

  it("shows a clock at zero as due for removal, never a negative countdown", async () => {
    const now = Date.now();
    scanner.queryAgents.mockResolvedValue({ items: [item("5", "Overdue")] });
    verifications.loadVerifications.mockResolvedValue(
      new Map([["5", { status: "dead", checkedAt: new Date(now).toISOString(), detail: null }]]),
    );
    verificationsStore.loadStaleTokens.mockResolvedValue([
      { tokenId: "5", name: "Overdue", category: "yield", status: "dead", failingSince: new Date(now - 9 * DAY).toISOString() },
    ]);
    shelf.loadShelfAgents.mockResolvedValue([{}]);

    const h = await health(now);

    expect(h.failing[0].daysLeft).toBe(0);
  });
});
