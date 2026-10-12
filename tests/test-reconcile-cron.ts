// the settlement reconcile cron: a broadcast whose wait for its receipt timed out is
// finished here. The chain is the only authority on whether money moved, so a transfer
// it reports as successful gets the record the buyer paid for, a reverted one closes
// with nothing written at all, and one still unmined is left open for the next pass.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// imported once rather than inside the helper: the cold graph (next/server, viem) is
// charged to whichever test pays for it, and under a full run that blows the timeout
import { GET } from "../src/app/api/cron/reconcile/route";
import type { StoredPayment } from "@/lib/x402";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  listUnresolvedSettlements: vi.fn(async () => [] as unknown[]),
  getPaymentDurable: vi.fn(async () => undefined),
  // the arg is typed rather than named, so the recorded calls are readable in the
  // assertions below without tripping the unused-vars rule on a mock that ignores it
  recordPaymentDurable: vi.fn<(payment: StoredPayment) => Promise<void>>(async () => {}),
  resolvePendingSettlement: vi.fn(async () => {}),
}));
vi.mock("@/lib/receipts-store", () => store);

// the receipt read is the only chain access, so it is the thing to control
const chain = vi.hoisted(() => ({
  receipt: null as { status: string } | null,
}));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionReceipt: async () => {
        if (!chain.receipt) throw new Error("transaction not found");
        return chain.receipt;
      },
    }),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  chain.receipt = null;
});

// a row whose settle request has had its full grace period, and whose session still runs
function settledRow() {
  return {
    paymentId: "pay-1",
    txHash: "0xabc",
    chainId: 56,
    payload: {
      paymentId: "pay-1",
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      txHash: "0xabc",
      mode: "prod",
      agent: { chainId: 56, tokenId: "1", name: "Range Reset" },
      client: "0xBUYER",
      payTo: "0xAGENT",
      amount: "2000000",
      symbol: "$U",
      activated: true,
      session: { spendCapUsd: 5, expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString() },
    },
  };
}

function run(auth?: string) {
  return GET(
    new NextRequest("https://api.agentsouk.xyz/api/cron/reconcile", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

describe("settlement reconcile cron", () => {
  it("runs only for the scheduler's secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await run("Bearer x")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "right");
    expect((await run("Bearer wrong")).status).toBe(401);
    expect(store.listUnresolvedSettlements).not.toHaveBeenCalled();
  });

  it("leaves a row alone until the settle request has had its grace period", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    const young = settledRow();
    young.payload.createdAt = new Date().toISOString();
    store.listUnresolvedSettlements.mockResolvedValueOnce([young]);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.stillPending).toBe(1);
    expect(store.recordPaymentDurable).not.toHaveBeenCalled();
    expect(store.resolvePendingSettlement).not.toHaveBeenCalled();
  });

  it("closes a row the settle request already recorded, without reading the chain", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.listUnresolvedSettlements.mockResolvedValueOnce([settledRow()]);
    store.getPaymentDurable.mockResolvedValueOnce({ paymentId: "pay-1" } as never);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.alreadyRecorded).toBe(1);
    expect(store.recordPaymentDurable).not.toHaveBeenCalled();
    expect(store.resolvePendingSettlement).toHaveBeenCalledWith("pay-1", "recorded");
  });

  it("writes nothing for a transfer the chain says reverted", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.listUnresolvedSettlements.mockResolvedValueOnce([settledRow()]);
    chain.receipt = { status: "reverted" };

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.reverted).toBe(1);
    expect(store.recordPaymentDurable).not.toHaveBeenCalled();
    expect(store.resolvePendingSettlement).toHaveBeenCalledWith("pay-1", "reverted");
  });

  it("records a transfer the chain says succeeded, keeping the payment time it settled at", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    const row = settledRow();
    store.listUnresolvedSettlements.mockResolvedValueOnce([row]);
    chain.receipt = { status: "success" };

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.recorded).toBe(1);
    const written = store.recordPaymentDurable.mock.calls[0][0];
    expect(written.paymentId).toBe("pay-1");
    expect(written.txHash).toBe("0xabc");
    expect(written.client).toBe("0xBUYER");
    // the session still runs, so it is handed over untouched
    expect(written.session.expiresAt).toBe(row.payload.session.expiresAt);
    expect(store.resolvePendingSettlement).toHaveBeenCalledWith("pay-1", "recorded");
  });

  it("restarts a session that lapsed while the settlement was unrecorded", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    const row = settledRow();
    row.payload.session.expiresAt = new Date(Date.now() - 60_000).toISOString();
    store.listUnresolvedSettlements.mockResolvedValueOnce([row]);
    chain.receipt = { status: "success" };

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.sessionsRestarted).toBe(1);
    const written = store.recordPaymentDurable.mock.calls[0][0];
    expect(Date.parse(written.session.expiresAt)).toBeGreaterThan(Date.now());
    // a receipt for a hire that already expired is a payment with no product behind it
    expect(written.session.spendCapUsd).toBe(5);
    expect(written.createdAt).toBe(row.payload.createdAt);
  });

  it("leaves a row open when the chain has not mined it yet", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    store.listUnresolvedSettlements.mockResolvedValueOnce([settledRow()]);

    const res = await run("Bearer right");
    const body = await res.json();

    expect(body.counts.stillPending).toBe(1);
    expect(body.results[0].outcome).toBe("still-pending");
    expect(store.recordPaymentDurable).not.toHaveBeenCalled();
    expect(store.resolvePendingSettlement).not.toHaveBeenCalled();
  });
});
