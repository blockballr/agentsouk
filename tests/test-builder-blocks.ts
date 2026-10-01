// the blocks a built agent is made of: each refuses arguments it cannot compute from, and
// each returns the figures the reference calculation gives, worked here by hand
import { describe, expect, it } from "vitest";
import { BLOCKS, DATA_SOURCES, getBlock, getSource } from "../src/lib/builder/blocks";

// WBNB/USDT 0.05% on BSC testnet; USDT sorts first, so WBNB, the base, is token1
const POOL = {
  pair: "WBNB/USDT",
  pool: "0x0000000000000000000000000000000000000abc",
  feeTier: 500,
  price: 9.8853,
  blockNumber: 123,
  sqrtPriceX96: "25198607551688324341071279158",
  tickSpacing: 10,
  baseIsToken0: false,
  decimals0: 18,
  decimals1: 18,
};

describe("the block list", () => {
  it("holds the five calculations and the comparison, each under its own id", () => {
    expect(Object.keys(BLOCKS).sort()).toEqual(
      ["compare-two", "drift-check", "grid-ladder", "health-factor", "liquidity-range", "net-yield"],
    );
    for (const [id, block] of Object.entries(BLOCKS)) expect(block.id).toBe(id);
    expect(Object.keys(DATA_SOURCES)).toEqual(["pancakeswap.v3.pool"]);
  });

  it("only takes a whole record where a pool is asked for", () => {
    const poolArgs = Object.values(BLOCKS).flatMap((b) =>
      Object.entries(b.inputs).filter(([, f]) => f.type === "pool").map(([name]) => `${b.id}.${name}`),
    );
    expect(poolArgs).toEqual(["liquidity-range.pool"]);
  });

  it("finds a block or a source by its own name only, never an inherited one", () => {
    expect(getBlock("health-factor")).toBe(BLOCKS["health-factor"]);
    expect(getSource("pancakeswap.v3.pool")?.record).toBe("pool");
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", 7, null, undefined]) {
      expect(getBlock(name)).toBeUndefined();
      expect(getSource(name)).toBeUndefined();
    }
  });
});

describe("health-factor", () => {
  const block = BLOCKS["health-factor"];

  it("computes 8000 of capacity over 6500 of debt", () => {
    const args = { collateralUsd: 10000, debtUsd: 6500, liquidationThreshold: 0.8 };
    expect(block.check(args)).toEqual([]);
    expect(block.run(args)).toEqual({
      healthFactor: 1.2308,
      state: "caution",
      liquidationCapacityUsd: 8000,
      collateralDropPercent: 18.75,
      additionalDebtUsd: 1500,
    });
  });

  it("uses a threshold of 0.8 when none is given, and has no ratio without debt", () => {
    expect(block.run({ collateralUsd: 1000, debtUsd: 500 }).healthFactor).toBe(1.6);
    expect(block.run({ collateralUsd: 1000, debtUsd: 0 })).toMatchObject({ healthFactor: null, state: "no-debt", collateralDropPercent: null });
  });

  it("refuses values it cannot compute from", () => {
    expect(block.check({ collateralUsd: 0, debtUsd: 10 })).toEqual(["collateralUsd must be a number above 0"]);
    expect(block.check({ collateralUsd: 100, debtUsd: -1 })).toEqual(["debtUsd must be 0 or a positive number"]);
    expect(block.check({ collateralUsd: 100 })).toEqual(["debtUsd must be 0 or a positive number"]);
    expect(block.check({ collateralUsd: 100, debtUsd: 10, liquidationThreshold: 80 })).toEqual([
      "liquidationThreshold must be a fraction above 0 and at most 1",
    ]);
    expect(block.check({ collateralUsd: "100", debtUsd: 10 })).toEqual(["collateralUsd must be a number above 0"]);
  });
});

describe("net-yield", () => {
  const block = BLOCKS["net-yield"];

  it("compounds 8% monthly to 8.3% and takes a 50 point fee off it", () => {
    const args = { principalUsd: 10000, grossApyPercent: 8, feeBps: 50 };
    expect(block.check(args)).toEqual([]);
    expect(block.run(args)).toEqual({
      netRatePercent: 7.8,
      effectiveAnnualRatePercent: 8.3,
      projectedEarningsUsd: 780,
      state: "net-positive",
    });
  });

  it("reports a fee larger than the yield as fee-dominated", () => {
    expect(block.run({ principalUsd: 1000, grossApyPercent: 1, compoundingPerYear: 1, feeBps: 300 })).toMatchObject({
      netRatePercent: -2,
      projectedEarningsUsd: -20,
      state: "fee-dominated",
    });
  });

  it("refuses a compounding count that is not a whole number in range", () => {
    expect(block.check({ principalUsd: 1000, grossApyPercent: 5, compoundingPerYear: 0 })).toHaveLength(1);
    expect(block.check({ principalUsd: 1000, grossApyPercent: 5, compoundingPerYear: 2.5 })).toHaveLength(1);
    expect(block.check({ principalUsd: 1000, grossApyPercent: 5, feeBps: 10001 })).toEqual(["feeBps must be from 0 to 10000"]);
  });
});

describe("grid-ladder", () => {
  const block = BLOCKS["grid-ladder"];

  it("spaces five rungs 50 apart and nets 9.9 a round trip after a 10 point fee", () => {
    const args = { lowerUsd: 500, upperUsd: 700, levels: 5, orderSizeUsd: 100, feeBps: 10 };
    expect(block.check(args)).toEqual([]);
    expect(block.run(args)).toEqual({
      spacingUsd: 50,
      committedUsd: 500,
      netCaptureUsd: 9.9,
      totalNetCaptureUsd: 39.6,
      state: "planned",
    });
  });

  it("refuses a range that is upside down or a rung count out of bounds", () => {
    expect(block.check({ lowerUsd: 700, upperUsd: 500, levels: 5, orderSizeUsd: 100 })).toEqual(["upperUsd must be above lowerUsd"]);
    expect(block.check({ lowerUsd: 500, upperUsd: 700, levels: 1, orderSizeUsd: 100 })).toEqual([
      "levels must be a whole number from 2 to 200",
    ]);
  });
});

describe("drift-check", () => {
  const block = BLOCKS["drift-check"];

  it("moves 2000 from the heavy side when 70/30 should be 50/50", () => {
    const args = { valueAUsd: 7000, valueBUsd: 3000, targetAPercent: 50, symbolA: "BNB", symbolB: "USDT" };
    expect(block.check(args)).toEqual([]);
    expect(block.run(args)).toEqual({
      currentAPercent: 70,
      driftAPercent: 20,
      rebalanceWarranted: true,
      valueToMoveUsd: 2000,
      fromSymbol: "BNB",
      toSymbol: "USDT",
      state: "rebalance",
    });
  });

  it("leaves a portfolio inside the band alone", () => {
    expect(block.run({ valueAUsd: 5200, valueBUsd: 4800, targetAPercent: 50 })).toMatchObject({
      rebalanceWarranted: false,
      valueToMoveUsd: null,
      fromSymbol: null,
      state: "in-band",
    });
  });

  it("refuses an empty portfolio rather than dividing by it", () => {
    expect(block.check({ valueAUsd: 0, valueBUsd: 0, targetAPercent: 50 })).toEqual(["valueAUsd and valueBUsd cannot both be 0"]);
    expect(block.check({ valueAUsd: 10, valueBUsd: 10, targetAPercent: 100 })).toEqual(["targetAPercent must be above 0 and below 100"]);
  });
});

describe("liquidity-range", () => {
  const block = BLOCKS["liquidity-range"];

  it("straddles the pool's price on its tick spacing and splits the deposit so it adds back up", () => {
    const args = { pool: POOL, widthPercent: 10, depositUsd: 100 };
    expect(block.check(args)).toEqual([]);
    const r = block.run(args) as Record<string, number>;
    expect(r.priceNow).toBeCloseTo(9.8853, 3);
    expect(r.priceLower).toBeLessThan(r.priceNow * 0.95 + 1e-6);
    expect(r.priceUpper).toBeGreaterThan(r.priceNow * 1.05 - 1e-6);
    expect(Number.isInteger(r.tickLower / 10)).toBe(true);
    expect(Number.isInteger(r.tickUpper / 10)).toBe(true);
    expect(r.quoteAmount + r.baseAmount * r.priceNow).toBeCloseTo(100, 1);
    expect(r.baseSharePercent).toBeGreaterThan(45);
    expect(r.baseSharePercent).toBeLessThan(55);
  });

  it("gives the range alone when no deposit is named", () => {
    expect(block.run({ pool: POOL, widthPercent: 10 })).toMatchObject({ baseAmount: null, quoteAmount: null, baseSharePercent: null });
  });

  it("refuses anything that is not the record a pool read returned", () => {
    expect(block.check({ pool: "WBNB/USDT", widthPercent: 10 })).toEqual(["pool must be the record read from pancakeswap.v3.pool"]);
    expect(block.check({ pool: { price: 9.9 }, widthPercent: 10 })).toHaveLength(1);
    expect(block.check({ pool: POOL, widthPercent: 0 })).toEqual(["widthPercent must be above 0 and at most 100"]);
  });

  it("refuses a width whose lower edge would be a price of zero", () => {
    expect(block.check({ pool: POOL, widthPercent: 200 })).toEqual(["widthPercent must be above 0 and at most 100"]);
    const widest = block.run({ pool: POOL, widthPercent: 100, depositUsd: 100 });
    for (const value of Object.values(widest)) expect(Number.isFinite(value as number)).toBe(true);
  });

  it("refuses a pool record it could not do arithmetic on", () => {
    const refused = ["pool must be the record read from pancakeswap.v3.pool"];
    for (const broken of [
      { sqrtPriceX96: "abc" },
      { sqrtPriceX96: "" },
      { sqrtPriceX96: "0" },
      { tickSpacing: 0 },
      { tickSpacing: 1.5 },
      { decimals0: undefined },
      { decimals1: "18" },
      { baseIsToken0: "no" },
    ]) {
      expect(block.check({ pool: { ...POOL, ...broken }, widthPercent: 10 })).toEqual(refused);
    }
  });
});

describe("compare-two", () => {
  const block = BLOCKS["compare-two"];

  it("names the higher of two figures and the gap between them", () => {
    expect(block.run({ first: 7.8, second: 7.9248, firstLabel: "Option A", secondLabel: "Option B" })).toEqual({
      higher: "Option B",
      difference: 0.1248,
    });
    expect(block.run({ first: 5, second: 5 })).toEqual({ higher: "equal", difference: 0 });
    expect(block.run({ first: 2, second: 1 })).toEqual({ higher: "the first", difference: 1 });
    expect(block.check({ first: 1 })).toEqual(["second must be a number"]);
    expect(block.check({ first: 1, second: null })).toEqual(["second must be a number"]);
  });
});
