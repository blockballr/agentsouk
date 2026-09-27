// The read-path cache and the by-wallet join. The routes run against mocked
// stores so the cache hit, miss, expiry, per-wallet key separation, and the
// revoke that must not be masked are all observable in process.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.RECEIPTS_STORE = "memory";
  process.env.TARGET_CHAIN = "56";
});

vi.mock("server-only", () => ({}));

const scanner = vi.hoisted(() => ({ queryAgents: vi.fn() }));
vi.mock("@/lib/scanner", () => scanner);

const receipts = vi.hoisted(() => ({
  listPaymentsByClient: vi.fn(async () => []),
  getPaymentDurable: vi.fn(),
  receiptsMode: vi.fn(() => "memory"),
  revokeSessionDurable: vi.fn(),
  cancelAuthorizationDurable: vi.fn(),
}));
vi.mock("@/lib/receipts-store", () => receipts);

const x402 = vi.hoisted(() => ({ listActiveSessions: vi.fn((): unknown[] => []) }));
vi.mock("@/lib/x402", () => x402);

const tasks = vi.hoisted(() => ({ listTasks: vi.fn(async () => []) }));
vi.mock("@/lib/tasks", () => tasks);

const jobs = vi.hoisted(() => ({
  listJobs: vi.fn(async () => []),
  getJobByPayment: vi.fn(() => undefined),
}));
vi.mock("@/lib/jobs", () => jobs);

import { NextRequest } from "next/server";
import { cached, invalidate, invalidatePrefix } from "../src/lib/short-cache";
import { GET as hiresGet } from "../src/app/api/hires/by-wallet/route";
import {
  DELETE as sessionsDelete,
  GET as sessionsGet,
} from "../src/app/api/sessions/route";

const WALLET_A = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const WALLET_B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";

function payment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    activated: true,
    client: WALLET_A,
    agent: { chainId: 56, tokenId: "1", name: "Agent" },
    session: { spendCapUsd: 2, expiresAt: "2099-01-01T00:00:00.000Z" },
    mode: "sandbox",
    createdAt: "2026-01-01T00:00:00.000Z",
    txHash: null,
    ...overrides,
  };
}

function activeSession(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    chainId: 56,
    tokenId: "1",
    agentName: "Agent",
    client: WALLET_A,
    spendCapUsd: 2,
    expiresAt: "2099-01-01T00:00:00.000Z",
    mode: "sandbox",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

describe("short cache", () => {
  beforeEach(() => {
    invalidatePrefix("");
  });

  it("serves a hit and misses on a different key", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    expect(await cached("unit:one", 1000, load)).toBe(1);
    expect(await cached("unit:one", 1000, load)).toBe(1);
    expect(loads).toBe(1);
    expect(await cached("unit:two", 1000, load)).toBe(2);
    expect(loads).toBe(2);
  });

  it("shares one load between concurrent misses", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      started += 1;
      await gate;
      return "value";
    };
    const first = cached("unit:flight", 1000, load);
    const second = cached("unit:flight", 1000, load);
    release();
    expect(await first).toBe("value");
    expect(await second).toBe("value");
    expect(started).toBe(1);
  });

  it("expires a value after its ttl", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    expect(await cached("unit:expiry", 20, load)).toBe(1);
    expect(await cached("unit:expiry", 20, load)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await cached("unit:expiry", 20, load)).toBe(2);
  });

  it("drops a value on invalidate", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return loads;
    };
    expect(await cached("unit:inv", 1000, load)).toBe(1);
    invalidate("unit:inv");
    expect(await cached("unit:inv", 1000, load)).toBe(2);
  });
});

describe("by-wallet read", () => {
  beforeEach(() => {
    invalidatePrefix("");
    vi.resetAllMocks();
    scanner.queryAgents.mockResolvedValue({ items: [] });
    receipts.listPaymentsByClient.mockResolvedValue([]);
    receipts.receiptsMode.mockReturnValue("memory");
  });

  it("separates wallets, caches each, and never looks a payment up per row", async () => {
    const a = payment({
      paymentId: "pay-a",
      client: WALLET_A,
      agent: { chainId: 56, tokenId: "1", name: "A" },
    });
    const b = payment({
      paymentId: "pay-b",
      client: WALLET_B,
      agent: { chainId: 56, tokenId: "2", name: "B" },
    });
    receipts.listPaymentsByClient.mockImplementation(async (wallet: string) =>
      wallet.toLowerCase() === WALLET_A.toLowerCase() ? [a] : [b],
    );
    scanner.queryAgents.mockResolvedValue({
      items: [
        { chain_id: 56, token_id: "1", category: "yield" },
        { chain_id: 56, token_id: "2", category: "grid-trading" },
      ],
    });

    const first = await (
      await hiresGet(get(`/api/hires/by-wallet?wallet=${WALLET_A}`))
    ).json();
    const second = await (
      await hiresGet(get(`/api/hires/by-wallet?wallet=${WALLET_B}`))
    ).json();
    const firstAgain = await (
      await hiresGet(get(`/api/hires/by-wallet?wallet=${WALLET_A}`))
    ).json();

    expect(
      first.hires.map((h: { agentName: string }) => h.agentName),
    ).toEqual(["A"]);
    expect(first.hires[0].category).toBe("yield");
    expect(
      second.hires.map((h: { agentName: string }) => h.agentName),
    ).toEqual(["B"]);
    expect(second.hires[0].category).toBe("grid-trading");
    expect(firstAgain.hires).toEqual(first.hires);
    // two wallets, two durable reads, the third request is a cache hit
    expect(receipts.listPaymentsByClient).toHaveBeenCalledTimes(2);
    // the shared catalogue is built once, not once per wallet
    expect(scanner.queryAgents).toHaveBeenCalledTimes(1);
    // the batched durable read means no per-payment store lookup
    expect(receipts.getPaymentDurable).not.toHaveBeenCalled();
  });

  it("keeps the honest empty and incomplete reporting", async () => {
    const activated = payment({ paymentId: "pay-on", client: WALLET_A });
    const unactivated = payment({
      paymentId: "pay-off",
      client: WALLET_A,
      activated: false,
      agent: { chainId: 56, tokenId: "2", name: "Off" },
    });
    receipts.listPaymentsByClient.mockResolvedValue([activated, unactivated]);

    const body = await (
      await hiresGet(get(`/api/hires/by-wallet?wallet=${WALLET_A}`))
    ).json();

    expect(body.source).toBe("memory");
    expect(body.counts.hires).toBe(1);
    expect(body.hires[0].agentName).toBe("Agent");
    // not in the catalogue and no snapshot on hand, so null rather than a guess
    expect(body.hires[0].category).toBeNull();
  });

  it("requires an address before doing any work", async () => {
    const res = await hiresGet(get("/api/hires/by-wallet?wallet=nope"));
    expect(res.status).toBe(400);
    expect(receipts.listPaymentsByClient).not.toHaveBeenCalled();
  });
});

describe("sessions read", () => {
  beforeEach(() => {
    invalidatePrefix("");
    vi.resetAllMocks();
    x402.listActiveSessions.mockReturnValue([]);
    tasks.listTasks.mockResolvedValue([]);
    jobs.listJobs.mockResolvedValue([]);
    jobs.getJobByPayment.mockReturnValue(undefined);
    receipts.getPaymentDurable.mockResolvedValue(undefined);
    receipts.revokeSessionDurable.mockResolvedValue(false);
    receipts.cancelAuthorizationDurable.mockResolvedValue({
      attempted: false,
      canceled: false,
    });
  });

  it("serves a hit, and a revoke is visible on the very next read", async () => {
    const active = activeSession({ paymentId: "pay-r", client: WALLET_A });
    x402.listActiveSessions.mockReturnValue([active]);
    const url = `/api/sessions?client=${WALLET_A}`;

    const before = await (await sessionsGet(get(url))).json();
    expect(before.sessions).toHaveLength(1);
    // the second read is a cache hit, so the durable store is not scanned again
    await sessionsGet(get(url));
    expect(tasks.listTasks).toHaveBeenCalledTimes(1);
    expect(jobs.listJobs).toHaveBeenCalledTimes(1);

    receipts.getPaymentDurable.mockResolvedValue({ client: WALLET_A });
    receipts.revokeSessionDurable.mockResolvedValue(true);
    const del = await sessionsDelete(
      new NextRequest(`http://localhost${url}&paymentId=pay-r`, {
        method: "DELETE",
      }),
    );
    expect(del.status).toBe(200);

    x402.listActiveSessions.mockReturnValue([]);
    const after = await (await sessionsGet(get(url))).json();
    expect(after.sessions).toHaveLength(0);
    // the write dropped the entry, so the read scanned the store again
    expect(tasks.listTasks).toHaveBeenCalledTimes(2);
  });

  it("keys the answer per wallet", async () => {
    x402.listActiveSessions.mockReturnValue([
      activeSession({ paymentId: "pay-a", client: WALLET_A, tokenId: "1" }),
      activeSession({ paymentId: "pay-b", client: WALLET_B, tokenId: "2" }),
    ]);

    const a = await (
      await sessionsGet(get(`/api/sessions?client=${WALLET_A}`))
    ).json();
    const b = await (
      await sessionsGet(get(`/api/sessions?client=${WALLET_B}`))
    ).json();

    expect(
      a.sessions.map((s: { session: { paymentId: string } }) => s.session.paymentId),
    ).toEqual(["pay-a"]);
    expect(
      b.sessions.map((s: { session: { paymentId: string } }) => s.session.paymentId),
    ).toEqual(["pay-b"]);
  });
});
