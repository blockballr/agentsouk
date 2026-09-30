// Band Keeper's PancakeSwap mode: a pair and a width ask for a v3 range around the pool
// price, everything is checked before the pool is read, and a pair mentioned in passing
// leaves the ordinary drift band check alone
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearPancakeCache, type PoolReader } from "../src/lib/pancake-read";
import { decideBandTaskLive } from "../src/lib/reference-band-live";

// WBNB/USDT 0.05% on BSC testnet; USDT sorts first, so WBNB is token1
const SQRT = BigInt("25198607551688324341071279158");
const POOL = "0x2dbb5a4c235164b9f772179a43faca2c71a8abdb" as const;

function reader(withPool = true): PoolReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    blockNumber: async () => {
      calls.push("blockNumber");
      return BigInt(134_000_000);
    },
    getPool: async (_a, _b, fee) =>
      withPool && fee === 500 ? POOL : "0x0000000000000000000000000000000000000000",
    liquidity: async () => BigInt(1000),
    slot0: async () => ({ sqrtPriceX96: SQRT, tick: -22913 }),
    tickSpacing: async () => 10,
  };
}

beforeEach(() => clearPancakeCache());

describe("Band Keeper PancakeSwap range", () => {
  it("suggests a range, splits the deposit and links to PancakeSwap with the range set", async () => {
    const reply = await decideBandTaskLive("", { input: { pair: "WBNB/USDT", widthPct: 10, depositUsd: 100 } }, { chainId: 97, reader: reader() });
    expect(reply.state).toBe("completed");
    const a = reply.artifact as {
      range: { tickLower: number; tickUpper: number; priceLower: number; priceUpper: number; priceNow: number };
      deposit: { baseAmount: number; quoteAmount: number };
      link: string;
      source: { pool: string; blockNumber: number; tickSpacing: number };
    };
    expect(Number.isInteger(a.range.tickLower / 10) && Number.isInteger(a.range.tickUpper / 10)).toBe(true);
    expect(a.range.priceLower).toBeLessThan(a.range.priceNow);
    expect(a.range.priceUpper).toBeGreaterThan(a.range.priceNow);
    expect(a.deposit.quoteAmount + a.deposit.baseAmount * a.range.priceNow).toBeCloseTo(100, 3);
    expect(a.link).toContain("https://pancakeswap.finance/add/0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd/0x337610d27c682E347C9cD60BD4b3b107C9d34dDd/500?chain=bscTestnet");
    expect(a.source).toMatchObject({ pool: POOL, blockNumber: 134_000_000, tickSpacing: 10 });
    expect(reply.text).toContain("on BSC testnet, so the price is a testnet one");
    expect(reply.text).toContain("I never add liquidity or trade");
  });

  it("reads a range request from prose that is about liquidity", async () => {
    const reply = await decideBandTaskLive(
      "Suggest a PancakeSwap liquidity range for WBNB/USDT 10% wide with a deposit of 100",
      undefined,
      { chainId: 97, reader: reader() },
    );
    expect(reply.state).toBe("completed");
    expect((reply.artifact as { deposit: { quote: number } }).deposit.quote).toBe(100);
  });

  it("leaves a band check that only mentions a pair to the band check", async () => {
    const r = reader();
    const reply = await decideBandTaskLive(
      "Check a band for valueA 700 and valueB 300 with a target of 50 percent, WBNB/USDT",
      undefined,
      { chainId: 97, reader: r },
    );
    expect(reply.artifact.action).toBe("check_band");
    expect(r.calls).toEqual([]);
  });

  it("keeps every drift band check out of range mode, whatever words sit beside it", async () => {
    const asks: [string, Record<string, unknown> | undefined][] = [
      ["Check my WBNB/USDT position: valueA 700, valueB 300, target 50 percent", undefined],
      ["Keep BNB/USDT inside a 5% band: valueA 700, valueB 300, target 50", undefined],
      ["Rebalance my BNB/USDT LP", { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, bandPercent: 5 }],
      ["BNB/USDT, valueA 700, valueB 300, target 50, width 5", undefined],
      ["", { pair: "WBNB/USDT", valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 }],
    ];
    for (const [task, input] of asks) {
      const r = reader();
      const reply = await decideBandTaskLive(task, input, { chainId: 97, reader: r });
      expect(reply.artifact.action, task).toBe("check_band");
      expect(r.calls).toEqual([]);
    }
  });

  it("reads a deposit written with thousands separators", async () => {
    for (const [task, amount] of [
      ["WBNB/USDT liquidity range 10% wide, deposit of $1,000", 1000],
      ["WBNB/USDT liquidity range 10% wide, deposit 2,500.5 USDT", 2500.5],
    ] as const) {
      const reply = await decideBandTaskLive(task, undefined, { chainId: 97, reader: reader() });
      expect((reply.artifact as { deposit: { quote: number } }).deposit.quote).toBe(amount);
    }
  });

  it("asks for a width before reading anything", async () => {
    const r = reader();
    const reply = await decideBandTaskLive("", { pair: "WBNB/USDT" }, { chainId: 97, reader: r });
    expect(reply.state).toBe("input-required");
    expect(reply.artifact.missing).toEqual(["widthPct"]);
    expect(r.calls).toEqual([]);
  });

  it("refuses a reversed pair and a bad deposit, naming what it takes", async () => {
    const r = reader();
    const reply = await decideBandTaskLive("", { pair: "USDT/WBNB", widthPct: 10, depositUsd: -5 }, { chainId: 97, reader: r });
    expect(reply.artifact.problems).toEqual([
      "pair must be WBNB/USDT, with the dollar token second",
      "depositUsd must be a positive number",
    ]);
    expect(r.calls).toEqual([]);
  });

  it("says so when the pool cannot be read", async () => {
    const reply = await decideBandTaskLive("", { pair: "WBNB/USDT", widthPct: 10 }, { chainId: 97, reader: reader(false) });
    expect(reply.state).toBe("input-required");
    expect(reply.text).toContain("I could not read the PancakeSwap pool");
  });
});
