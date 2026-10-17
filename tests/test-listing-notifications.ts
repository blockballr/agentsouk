// The daily maintenance pass warns the owner before a failing listing leaves
// the shelf: a day of no answer earns one bell, seven days earns the removal
// notice, and the streak start keys both so a rerun writes nothing twice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/cron/maintenance/route";

vi.mock("server-only", () => ({}));

type Stale = { tokenId: string; name: string; category: string; status: string; failingSince: string };

const store = vi.hoisted(() => ({
  // the window argument tells the two reads apart: the delist asks for seven
  // days, the warn asks for one
  loadStaleTokens: vi.fn(async (_windowMs?: number) => [] as Stale[]),
  DELIST_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock("@/lib/verifications-store", () => store);

const delist = vi.hoisted(() => ({ setDelisted: vi.fn(async (_tokenId: string, _flag: boolean, _reason: string) => true) }));
vi.mock("@/lib/delist-store", () => delist);

const notes = vi.hoisted(() => ({
  emitNotification: vi.fn(async (input: Record<string, unknown>) => input),
}));
vi.mock("@/lib/notifications", () => notes);

const shelf = vi.hoisted(() => ({
  queryAgents: vi.fn(async (_opts: Record<string, unknown>) => ({ items: [] as { token_id: string; owner_address: string }[] })),
}));
vi.mock("@/lib/scanner", () => shelf);

const escrow = vi.hoisted(() => ({
  escrowFunder: vi.fn(() => null),
  escrowStatuses: vi.fn(async () => []),
  releaseEscrowIfDue: vi.fn(async () => null),
}));
vi.mock("@/lib/escrow", () => escrow);

const receipts = vi.hoisted(() => ({ listRecentPayments: vi.fn(async () => []) }));
vi.mock("@/lib/receipts-store", () => receipts);

const history = vi.hoisted(() => ({
  loggedCronRun: vi.fn(async (_name: string, fn: () => Promise<Response>) => fn()),
}));
vi.mock("@/lib/history-store", () => history);

vi.mock("@/lib/types", () => ({ targetChainId: () => 56 }));

const OWNER = "0x52DA44aB471455437fc17979c52E501f6b8d0EAF";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function token(overrides: Partial<Stale> = {}): Stale {
  return {
    tokenId: "7",
    name: "Range Reset",
    category: "grid-trading",
    status: "unreachable",
    failingSince: "2026-10-14T09:00:00.000Z",
    ...overrides,
  };
}

function withOwner(owner: string) {
  shelf.queryAgents.mockResolvedValueOnce({ items: [{ token_id: "7", owner_address: owner }] });
}

function run(auth?: string) {
  return GET(
    new NextRequest("https://api.agentsouk.xyz/api/cron/maintenance", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, so the pass-through defaults go back
  // by hand: one test's shelf or window must never reach the next
  store.loadStaleTokens.mockImplementation(async () => []);
  delist.setDelisted.mockImplementation(async () => true);
  shelf.queryAgents.mockImplementation(async () => ({ items: [] }));
});

describe("maintenance warns the owner of a failing listing", () => {
  it("runs only for the scheduler's secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await run("Bearer x")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "right");
    expect((await run("Bearer wrong")).status).toBe(401);
    expect(store.loadStaleTokens).not.toHaveBeenCalled();
    expect(notes.emitNotification).not.toHaveBeenCalled();
  });

  it("writes nothing on a clean pass, and reads no shelf at all", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    const res = await run("Bearer right");
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warned).toEqual([]);
    expect(body.delisted).toEqual([]);
    expect(notes.emitNotification).not.toHaveBeenCalled();
    expect(shelf.queryAgents).not.toHaveBeenCalled();
  });

  it("rings the owner once a day the listing keeps failing", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.loadStaleTokens.mockImplementation(async (ms) => ((ms ?? 0) >= WEEK ? [] : [token()]));
    withOwner(OWNER);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.warned).toEqual(["7"]);
    expect(body.delisted).toEqual([]);
    expect(delist.setDelisted).not.toHaveBeenCalled();
    expect(notes.emitNotification).toHaveBeenCalledTimes(1);
    expect(notes.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: OWNER,
        kind: "listing_failing",
        title: "Listing needs a check",
        href: "/agents/56/7",
      }),
    );
    const call = notes.emitNotification.mock.calls[0][0];
    expect(call.eventKey).toMatch(/^7-\d+$/);
    expect(String(call.body)).toContain("since 2026-10-14");
  });

  it("keeps the key stable across runs of the same streak", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.loadStaleTokens.mockImplementation(async (ms) => ((ms ?? 0) >= WEEK ? [] : [token()]));
    shelf.queryAgents.mockResolvedValue({ items: [{ token_id: "7", owner_address: OWNER }] });

    await run("Bearer right");
    await run("Bearer right");

    const keys = notes.emitNotification.mock.calls.map((c) => (c[0] as { eventKey: string }).eventKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("tells the owner once when the seven day removal fires, not also to check", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.loadStaleTokens.mockImplementation(async () => [token()]);
    withOwner(OWNER);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.delisted).toEqual(["7"]);
    expect(body.warned).toEqual([]);
    expect(delist.setDelisted).toHaveBeenCalledWith("7", true, "auto-stale");
    expect(notes.emitNotification).toHaveBeenCalledTimes(1);
    expect(notes.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: OWNER,
        kind: "listing_delisted",
        href: "/seller/stalls",
      }),
    );
  });

  it("keeps quiet when the removal was already written", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.loadStaleTokens.mockImplementation(async () => [token()]);
    delist.setDelisted.mockResolvedValueOnce(false);
    withOwner(OWNER);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.delisted).toEqual([]);
    expect(notes.emitNotification).not.toHaveBeenCalled();
  });

  it("skips a token the shelf gives no owner, or the zero address", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.loadStaleTokens.mockImplementation(async (ms) => ((ms ?? 0) >= WEEK ? [] : [token()]));

    await run("Bearer right");
    expect(notes.emitNotification).not.toHaveBeenCalled();

    shelf.queryAgents.mockResolvedValueOnce({
      items: [{ token_id: "7", owner_address: "0x0000000000000000000000000000000000000000" }],
    });
    await run("Bearer right");
    expect(notes.emitNotification).not.toHaveBeenCalled();
  });
});
