import { describe, expect, it } from "vitest";
import { chunksForWindow, summarizeExecutorActivity } from "../src/lib/executor-activity";

const A = "0xCd90519257BF4CbF668cdBd3a8771FbF3cb1cfA0";
const B = "0x5d328e476F9D81Bb52DBAA37895804775e49731f";
const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("executor activity", () => {
  const trades = [
    { agent: A.toLowerCase(), txHash: "0x01", blockNumber: 100 },
    { agent: A, txHash: "0x02", blockNumber: 300 },
    { agent: "0x0000000000000000000000000000000000000009", txHash: "0x03", blockNumber: 400 },
  ];
  const receipts = [
    { agent: A, status: "traded" as const, createdAt: hoursAgo(2) },
    { agent: A.toLowerCase(), status: "skipped" as const, createdAt: hoursAgo(1) },
    { agent: A, status: "traded" as const, createdAt: hoursAgo(30) },
    { agent: B, status: "refused" as const, createdAt: hoursAgo(3) },
  ];

  it("counts each executor's own trades and names the newest", () => {
    const [a, b] = summarizeExecutorActivity({
      executors: [A, B],
      trades,
      receipts,
      since: NOW - 24 * 3_600_000,
      blockTimes: new Map([[300, hoursAgo(2)]]),
    });
    expect(a.chainTrades).toBe(2);
    expect(a.lastChainTrade).toEqual({ txHash: "0x02", blockNumber: 300, at: hoursAgo(2) });
    expect(a.active).toBe(true);
    expect(b.chainTrades).toBe(0);
    expect(b.lastChainTrade).toBeNull();
    expect(b.active).toBe(false);
  });

  it("separates passes inside the window from the newest pass of any age", () => {
    const [a, b] = summarizeExecutorActivity({ executors: [A, B], trades, receipts, since: NOW - 24 * 3_600_000 });
    expect(a.receipts).toEqual({ traded: 1, skipped: 1, refused: 0 });
    expect(a.lastPassAt).toBe(hoursAgo(1));
    expect(a.lastTradedReceiptAt).toBe(hoursAgo(2));
    // run, but did not trade: the pass shows up even though the chain shows nothing
    expect(b.receipts).toEqual({ traded: 0, skipped: 0, refused: 1 });
    expect(b.lastPassAt).toBe(hoursAgo(3));
    expect(b.lastTradedReceiptAt).toBeNull();
  });

  it("says nothing happened for an executor with no record at all", () => {
    const [row] = summarizeExecutorActivity({ executors: [B], trades: [], receipts: [], since: NOW });
    expect(row).toEqual({
      address: B,
      hires: null,
      openHires: null,
      chainTrades: 0,
      lastChainTrade: null,
      receipts: { traded: 0, skipped: 0, refused: 0 },
      lastPassAt: null,
      lastTradedReceiptAt: null,
      active: false,
    });
  });

  it("counts an executor with an open hire as active even with no recent trade", () => {
    const hires = new Map([
      [A.toLowerCase(), { total: 8, open: 0 }],
      [B.toLowerCase(), { total: 2, open: 1 }],
    ]);
    const [a, b] = summarizeExecutorActivity({ executors: [A, B], trades: [], receipts: [], since: NOW, hires });
    expect([a.hires, a.openHires, a.active]).toEqual([8, 0, false]);
    expect([b.hires, b.openHires, b.active]).toEqual([2, 1, true]);
  });

  it("sizes the scan to the chain's pace and stops at the cap", () => {
    expect(chunksForWindow(24, 3, 3_000, 40)).toBe(10);
    expect(chunksForWindow(24, 0.75, 3_000, 40)).toBe(39);
    expect(chunksForWindow(72, 0.75, 3_000, 40)).toBe(40);
    expect(chunksForWindow(1, 3, 3_000, 40)).toBe(1);
    expect(chunksForWindow(24, 0, 3_000, 40)).toBe(40);
  });
});
