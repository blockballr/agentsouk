// what the team panel's figures are worked out from: buyers kept apart from our own checks,
// money summed per asset, counts by day, and what counts as stuck
import { describe, expect, it } from "vitest";
import { checksByDay, countByDay, payerKind, settledTotals, stuckItems, windowFigures, type PaymentRow } from "../src/lib/station-view";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const BUYER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const RELAY = "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4";

function pay(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    paymentId: "req_1",
    createdAt: "2026-10-05T09:00:00Z",
    client: BUYER,
    payTo: "0x1111111111111111111111111111111111111111",
    amount: "2000000000000000000",
    symbol: "sUSD",
    decimals: 18,
    mode: "prod",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    txHash: "0xabc",
    ...over,
  };
}

describe("who paid", () => {
  it("is a buyer unless it is our own check or one of our wallets", () => {
    expect(payerKind(pay())).toBe("buyer");
    expect(payerKind(pay({ paymentId: "verify_17a7fc3cbe5b", client: RELAY }))).toBe("check");
    expect(payerKind(pay({ client: RELAY.toLowerCase() }))).toBe("team");
  });

  it("is not a buyer when a wallet pays itself", () => {
    expect(payerKind(pay({ payTo: BUYER.toUpperCase().replace("0X", "0x") }))).toBe("self");
  });
});

describe("a window's figures", () => {
  const rows = [
    pay({ paymentId: "req_today" }),
    pay({ paymentId: "req_week", createdAt: "2026-10-01T09:00:00Z" }),
    pay({ paymentId: "req_old", createdAt: "2026-09-01T09:00:00Z" }),
    pay({ paymentId: "verify_1", client: RELAY }),
    pay({ paymentId: "req_sandbox", mode: "sandbox" }),
    pay({ paymentId: "req_team", client: RELAY }),
  ];

  it("count buyers' settled hires since the moment, with our checks beside them", () => {
    const today = windowFigures(rows, "today", Date.parse("2026-10-05T00:00:00Z"));
    expect(today).toEqual({ key: "today", buyerHires: 1, ownChecks: 1, settled: [{ chainId: 97, symbol: "sUSD", amount: "2" }] });
    expect(windowFigures(rows, "week", NOW - 7 * 86_400_000).buyerHires).toBe(2);
    expect(windowFigures(rows, "all", 0).settled).toEqual([{ chainId: 97, symbol: "sUSD", amount: "6" }]);
  });

  it("keep a receipt whose date cannot be read in the all-time window", () => {
    expect(windowFigures([pay({ createdAt: "not a date" })], "all", 0).buyerHires).toBe(1);
    expect(windowFigures([pay({ createdAt: "not a date" })], "week", NOW - 7 * 86_400_000).buyerHires).toBe(0);
  });

  it("never add two assets together, and name a count where the units are unknown", () => {
    const totals = settledTotals([pay(), pay({ symbol: "U", amount: "500000000000000000" }), pay({ symbol: "X", decimals: null })]);
    expect(totals).toEqual([
      { chainId: 97, symbol: "sUSD", amount: "2" },
      { chainId: 97, symbol: "U", amount: "0.5" },
      { chainId: 97, symbol: "X", amount: "1 payments" },
    ]);
  });

  it("keep one symbol on two chains apart", () => {
    const totals = settledTotals([pay(), pay({ chainId: 56, decimals: 6, amount: "3000000" })]);
    expect(totals).toEqual([
      { chainId: 97, symbol: "sUSD", amount: "2" },
      { chainId: 56, symbol: "sUSD", amount: "3" },
    ]);
  });
});

describe("counts by day", () => {
  it("run oldest first with a zero for a quiet day", () => {
    expect(countByDay(["2026-10-05T01:00:00Z", "2026-10-03T10:00:00Z", "nonsense"], 3, NOW)).toEqual([
      { day: "2026-10-03", count: 1 },
      { day: "2026-10-04", count: 0 },
      { day: "2026-10-05", count: 1 },
    ]);
  });

  it("read a gated check as passed and only no answer as failed", () => {
    const days = checksByDay(
      [
        { status: "delivered", checkedAt: "2026-10-05T01:00:00Z" },
        { status: "gated", checkedAt: "2026-10-05T02:00:00Z" },
        { status: "dead", checkedAt: "2026-10-05T03:00:00Z" },
        { status: "unreachable", checkedAt: "2026-10-04T03:00:00Z" },
      ],
      2,
      NOW,
    );
    expect(days).toEqual([
      { day: "2026-10-04", passed: 0, failed: 1 },
      { day: "2026-10-05", passed: 2, failed: 1 },
    ]);
  });
});

describe("what is stuck", () => {
  const job = (over: Record<string, unknown> = {}) => ({ id: "job_1", status: "Funded", paymentId: "req_1", agentName: "Keel", updatedAt: "2026-10-05T09:00:00Z", ...over });
  const task = (over: Record<string, unknown> = {}) => ({ id: "task_1", status: "failed", paymentId: "req_1", agentName: "Keel", error: "timed out", updatedAt: "2026-10-05T11:00:00Z", ...over });

  it("is a failed delivery, or a job paid an hour ago with nothing delivered", () => {
    const stuck = stuckItems([job()], [task()], NOW);
    expect(stuck.map((s) => s.kind)).toEqual(["delivery failed", "paid, nothing delivered"]);
    expect(stuck[0].note).toBe("Keel: timed out");
  });

  it("keeps the jobs that have waited longest when failures pile up", () => {
    const failures = Array.from({ length: 150 }, (_, i) => task({ id: `task_${i}`, updatedAt: `2026-10-05T10:${String(i % 60).padStart(2, "0")}:00Z` }));
    const stuck = stuckItems([job({ id: "job_old", updatedAt: "2026-09-20T09:00:00Z" })], failures, NOW);
    expect(stuck.filter((s) => s.kind === "delivery failed")).toHaveLength(100);
    expect(stuck.at(-1)?.id).toBe("job_old");
  });

  it("is not a job paid minutes ago, a job that moved on, or anything of our own checks", () => {
    expect(stuckItems([job({ updatedAt: "2026-10-05T11:50:00Z" })], [], NOW)).toEqual([]);
    expect(stuckItems([job({ status: "Submitted" })], [task({ status: "delivered" })], NOW)).toEqual([]);
    expect(stuckItems([job({ paymentId: "verify_1" })], [task({ paymentId: "verify_1" })], NOW)).toEqual([]);
  });
});
