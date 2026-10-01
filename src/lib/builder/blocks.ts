// the tested calculations a built agent may use, and the live data it may read. A blueprint
// chooses and connects these; it never brings code of its own

import { computeHealthFactor, DEFAULT_LIQUIDATION_THRESHOLD } from "../house-agent";
import { suggestRange } from "../pancake-range";
import { DEFAULT_FEE_BPS as GRID_DEFAULT_FEE_BPS, MAX_LEVELS, MIN_LEVELS, planGrid } from "../reference-grid";
import { computeRebalance, DEFAULT_DRIFT_THRESHOLD_PERCENT } from "../reference-rebalancing";
import {
  computeNetYield,
  DEFAULT_COMPOUNDING_PER_YEAR,
  MAX_COMPOUNDING_PER_YEAR,
  MAX_FEE_BPS,
  MIN_COMPOUNDING_PER_YEAR,
} from "../reference-yield";

export type Scalar = number | string | boolean | null;
// a value moving through a run: a scalar, or the record a data read returned
export type Value = Scalar | Record<string, unknown>;
export type FieldType = "number" | "text" | "boolean" | "pool";

export interface FieldSpec {
  type: FieldType;
  required: boolean;
  description: string;
}

export interface BlockSpec {
  id: string;
  summary: string;
  inputs: Record<string, FieldSpec>;
  outputs: Record<string, { type: "number" | "text" | "boolean"; description: string }>;
  // what is wrong with the arguments, in words a caller can act on; empty when they are usable
  check(args: Record<string, Value>): string[];
  run(args: Record<string, Value>): Record<string, Scalar>;
}

export interface DataSourceSpec {
  id: string;
  summary: string;
  args: Record<string, FieldSpec>;
  outputs: Record<string, { type: "number" | "text" | "boolean"; description: string }>;
  // the kind of record it returns, for a block argument that takes the whole record
  record: FieldType;
}

const num = (v: Value | undefined): number => (typeof v === "number" ? v : Number.NaN);
const text = (v: Value | undefined, fallback: string): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const given = (v: Value | undefined): boolean => v !== undefined && v !== null && v !== "";
const finite = (v: Value | undefined): boolean => Number.isFinite(num(v));

const healthFactor: BlockSpec = {
  id: "health-factor",
  summary: "Health factor of a lending position, its liquidation capacity and how far collateral can fall before liquidation.",
  inputs: {
    collateralUsd: { type: "number", required: true, description: "collateral value in USD, above 0" },
    debtUsd: { type: "number", required: true, description: "debt value in USD, 0 or more" },
    liquidationThreshold: { type: "number", required: false, description: `fraction above 0 and at most 1; defaults to ${DEFAULT_LIQUIDATION_THRESHOLD}` },
  },
  outputs: {
    healthFactor: { type: "number", description: "collateral times threshold over debt; empty when there is no debt" },
    state: { type: "text", description: "healthy, caution, liquidatable or no-debt" },
    liquidationCapacityUsd: { type: "number", description: "debt the collateral can carry at a health factor of 1" },
    collateralDropPercent: { type: "number", description: "how far collateral value can fall before the health factor reaches 1" },
    additionalDebtUsd: { type: "number", description: "further debt the position can take before liquidation" },
  },
  check(a) {
    const problems: string[] = [];
    if (!(num(a.collateralUsd) > 0)) problems.push("collateralUsd must be a number above 0");
    if (!(num(a.debtUsd) >= 0)) problems.push("debtUsd must be 0 or a positive number");
    if (given(a.liquidationThreshold) && !(num(a.liquidationThreshold) > 0 && num(a.liquidationThreshold) <= 1)) {
      problems.push("liquidationThreshold must be a fraction above 0 and at most 1");
    }
    return problems;
  },
  run(a) {
    const r = computeHealthFactor({
      collateral: num(a.collateralUsd),
      debt: num(a.debtUsd),
      liquidationThreshold: given(a.liquidationThreshold) ? num(a.liquidationThreshold) : DEFAULT_LIQUIDATION_THRESHOLD,
    });
    return {
      healthFactor: r.healthFactor,
      state: r.state,
      liquidationCapacityUsd: r.liquidationCapacity,
      collateralDropPercent: r.liquidationDistance === null ? null : Number((r.liquidationDistance * 100).toFixed(2)),
      additionalDebtUsd: r.additionalDebtBeforeLiquidation,
    };
  },
};

const netYield: BlockSpec = {
  id: "net-yield",
  summary: "Net yearly rate and projected one-year earnings from a gross APY, how often it compounds and a fee.",
  inputs: {
    principalUsd: { type: "number", required: true, description: "principal in USD, above 0" },
    grossApyPercent: { type: "number", required: true, description: "gross APY as a percentage, 0 or more" },
    compoundingPerYear: { type: "number", required: false, description: `compounding periods per year, ${MIN_COMPOUNDING_PER_YEAR} to ${MAX_COMPOUNDING_PER_YEAR}; defaults to ${DEFAULT_COMPOUNDING_PER_YEAR}` },
    feeBps: { type: "number", required: false, description: `yearly fee in basis points, 0 to ${MAX_FEE_BPS}; defaults to 0` },
  },
  outputs: {
    netRatePercent: { type: "number", description: "effective yearly rate after the fee" },
    effectiveAnnualRatePercent: { type: "number", description: "effective yearly rate before the fee" },
    projectedEarningsUsd: { type: "number", description: "one-year earnings on the principal at the net rate" },
    state: { type: "text", description: "net-positive or fee-dominated" },
  },
  check(a) {
    const problems: string[] = [];
    if (!(num(a.principalUsd) > 0)) problems.push("principalUsd must be a number above 0");
    if (!(num(a.grossApyPercent) >= 0)) problems.push("grossApyPercent must be 0 or a positive number");
    if (given(a.compoundingPerYear)) {
      const n = num(a.compoundingPerYear);
      if (!(Number.isInteger(n) && n >= MIN_COMPOUNDING_PER_YEAR && n <= MAX_COMPOUNDING_PER_YEAR)) {
        problems.push(`compoundingPerYear must be a whole number from ${MIN_COMPOUNDING_PER_YEAR} to ${MAX_COMPOUNDING_PER_YEAR}`);
      }
    }
    if (given(a.feeBps) && !(num(a.feeBps) >= 0 && num(a.feeBps) <= MAX_FEE_BPS)) {
      problems.push(`feeBps must be from 0 to ${MAX_FEE_BPS}`);
    }
    return problems;
  },
  run(a) {
    const r = computeNetYield({
      principalUsd: num(a.principalUsd),
      grossApyPercent: num(a.grossApyPercent),
      compoundingPerYear: given(a.compoundingPerYear) ? num(a.compoundingPerYear) : DEFAULT_COMPOUNDING_PER_YEAR,
      feeBps: given(a.feeBps) ? num(a.feeBps) : 0,
    });
    return {
      netRatePercent: r.netRatePercent,
      effectiveAnnualRatePercent: r.effectiveAnnualRatePercent,
      projectedEarningsUsd: r.projectedEarningsUsd,
      state: r.state,
    };
  },
};

const gridLadder: BlockSpec = {
  id: "grid-ladder",
  summary: "An evenly spaced grid of buy and sell rungs between two prices, with the capture of one round trip after fees.",
  inputs: {
    lowerUsd: { type: "number", required: true, description: "lowest rung price in USD, above 0" },
    upperUsd: { type: "number", required: true, description: "highest rung price in USD, above the lowest" },
    levels: { type: "number", required: true, description: `number of rungs, ${MIN_LEVELS} to ${MAX_LEVELS}` },
    orderSizeUsd: { type: "number", required: true, description: "USD committed at each rung, above 0" },
    feeBps: { type: "number", required: false, description: "fee per order in basis points; defaults to 0" },
  },
  outputs: {
    spacingUsd: { type: "number", description: "price gap between neighbouring rungs" },
    committedUsd: { type: "number", description: "total USD committed across the grid" },
    netCaptureUsd: { type: "number", description: "profit of one completed round trip after fees" },
    totalNetCaptureUsd: { type: "number", description: "profit if price crosses the whole range once" },
    state: { type: "text", description: "planned or fee-dominated" },
  },
  check(a) {
    const problems: string[] = [];
    if (!(num(a.lowerUsd) > 0)) problems.push("lowerUsd must be a number above 0");
    if (!(num(a.upperUsd) > num(a.lowerUsd))) problems.push("upperUsd must be above lowerUsd");
    const levels = num(a.levels);
    if (!(Number.isInteger(levels) && levels >= MIN_LEVELS && levels <= MAX_LEVELS)) {
      problems.push(`levels must be a whole number from ${MIN_LEVELS} to ${MAX_LEVELS}`);
    }
    if (!(num(a.orderSizeUsd) > 0)) problems.push("orderSizeUsd must be a number above 0");
    if (given(a.feeBps) && !(num(a.feeBps) >= 0 && num(a.feeBps) <= MAX_FEE_BPS)) {
      problems.push(`feeBps must be from 0 to ${MAX_FEE_BPS}`);
    }
    return problems;
  },
  run(a) {
    const r = planGrid({
      lowerUsd: num(a.lowerUsd),
      upperUsd: num(a.upperUsd),
      levels: num(a.levels),
      orderSizeUsd: num(a.orderSizeUsd),
      feeBps: given(a.feeBps) ? num(a.feeBps) : GRID_DEFAULT_FEE_BPS,
    });
    return {
      spacingUsd: r.spacingUsd,
      committedUsd: r.committedUsd,
      netCaptureUsd: r.netCaptureUsd,
      totalNetCaptureUsd: r.totalNetCaptureUsd,
      state: r.state,
    };
  },
};

const driftCheck: BlockSpec = {
  id: "drift-check",
  summary: "Whether a two-asset portfolio has drifted past a threshold from its target split, and what to move to restore it.",
  inputs: {
    valueAUsd: { type: "number", required: true, description: "USD value held in asset A, 0 or more" },
    valueBUsd: { type: "number", required: true, description: "USD value held in asset B, 0 or more" },
    targetAPercent: { type: "number", required: true, description: "target share of asset A, above 0 and below 100" },
    thresholdPercent: { type: "number", required: false, description: `drift in percentage points that warrants a rebalance; defaults to ${DEFAULT_DRIFT_THRESHOLD_PERCENT}` },
    symbolA: { type: "text", required: false, description: "name of asset A; defaults to A" },
    symbolB: { type: "text", required: false, description: "name of asset B; defaults to B" },
  },
  outputs: {
    currentAPercent: { type: "number", description: "current share of asset A" },
    driftAPercent: { type: "number", description: "current share minus target, in percentage points" },
    rebalanceWarranted: { type: "boolean", description: "whether the drift is past the threshold" },
    valueToMoveUsd: { type: "number", description: "USD to move to restore the target; empty when in band" },
    fromSymbol: { type: "text", description: "asset to sell; empty when in band" },
    toSymbol: { type: "text", description: "asset to buy; empty when in band" },
    state: { type: "text", description: "rebalance or in-band" },
  },
  check(a) {
    const problems: string[] = [];
    if (!(num(a.valueAUsd) >= 0)) problems.push("valueAUsd must be 0 or a positive number");
    if (!(num(a.valueBUsd) >= 0)) problems.push("valueBUsd must be 0 or a positive number");
    if (finite(a.valueAUsd) && finite(a.valueBUsd) && !(num(a.valueAUsd) + num(a.valueBUsd) > 0)) {
      problems.push("valueAUsd and valueBUsd cannot both be 0");
    }
    if (!(num(a.targetAPercent) > 0 && num(a.targetAPercent) < 100)) problems.push("targetAPercent must be above 0 and below 100");
    if (given(a.thresholdPercent) && !(num(a.thresholdPercent) > 0 && num(a.thresholdPercent) < 100)) {
      problems.push("thresholdPercent must be above 0 and below 100");
    }
    return problems;
  },
  run(a) {
    const r = computeRebalance({
      valueAUsd: num(a.valueAUsd),
      valueBUsd: num(a.valueBUsd),
      targetAPercent: num(a.targetAPercent),
      thresholdPercent: given(a.thresholdPercent) ? num(a.thresholdPercent) : DEFAULT_DRIFT_THRESHOLD_PERCENT,
      symbolA: text(a.symbolA, "A"),
      symbolB: text(a.symbolB, "B"),
    });
    return {
      currentAPercent: r.currentAPercent,
      driftAPercent: r.driftAPercent,
      rebalanceWarranted: r.rebalanceWarranted,
      valueToMoveUsd: r.valueToMoveUsd,
      fromSymbol: r.fromSymbol,
      toSymbol: r.toSymbol,
      state: r.state,
    };
  },
};

export const MAX_RANGE_WIDTH_PERCENT = 100;

// everything suggestRange reads from a pool, checked before it is trusted with arithmetic
function isPoolRecord(value: Value | undefined): boolean {
  if (!value || typeof value !== "object") return false;
  const pool = value as Record<string, unknown>;
  const decimals = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 36;
  return (
    typeof pool.sqrtPriceX96 === "string" &&
    /^[1-9]\d{0,60}$/.test(pool.sqrtPriceX96) &&
    typeof pool.tickSpacing === "number" &&
    Number.isInteger(pool.tickSpacing) &&
    pool.tickSpacing > 0 &&
    decimals(pool.decimals0) &&
    decimals(pool.decimals1) &&
    typeof pool.baseIsToken0 === "boolean"
  );
}

const liquidityRange: BlockSpec = {
  id: "liquidity-range",
  summary: "A PancakeSwap v3 liquidity range of a chosen width around a pool's current price, and how a deposit splits between the two tokens.",
  inputs: {
    pool: { type: "pool", required: true, description: "the record read from the pancakeswap.v3.pool source" },
    widthPercent: { type: "number", required: true, description: `full width of the range around the price, above 0 and at most ${MAX_RANGE_WIDTH_PERCENT}` },
    depositUsd: { type: "number", required: false, description: "deposit valued in the quote token, above 0" },
  },
  outputs: {
    priceNow: { type: "number", description: "the pool's price when it was read" },
    priceLower: { type: "number", description: "price at the lower edge of the range" },
    priceUpper: { type: "number", description: "price at the upper edge of the range" },
    tickLower: { type: "number", description: "lower tick, aligned to the pool's spacing" },
    tickUpper: { type: "number", description: "upper tick, aligned to the pool's spacing" },
    baseAmount: { type: "number", description: "base token the deposit takes; empty without a deposit" },
    quoteAmount: { type: "number", description: "quote token the deposit takes; empty without a deposit" },
    baseSharePercent: { type: "number", description: "share of the deposit held as the base token; empty without a deposit" },
  },
  check(a) {
    const problems: string[] = [];
    if (!isPoolRecord(a.pool)) problems.push("pool must be the record read from pancakeswap.v3.pool");
    // at 200 the lower edge is a price of zero, which has no tick
    if (!(num(a.widthPercent) > 0 && num(a.widthPercent) <= MAX_RANGE_WIDTH_PERCENT)) {
      problems.push(`widthPercent must be above 0 and at most ${MAX_RANGE_WIDTH_PERCENT}`);
    }
    if (given(a.depositUsd) && !(num(a.depositUsd) > 0)) problems.push("depositUsd must be a number above 0");
    return problems;
  },
  run(a) {
    const pool = a.pool as Record<string, unknown>;
    const r = suggestRange({
      sqrtPriceX96: BigInt(pool.sqrtPriceX96 as string),
      tickSpacing: Number(pool.tickSpacing),
      decimals0: Number(pool.decimals0),
      decimals1: Number(pool.decimals1),
      baseIsToken0: Boolean(pool.baseIsToken0),
      widthPct: num(a.widthPercent),
      depositQuote: given(a.depositUsd) ? num(a.depositUsd) : undefined,
    });
    const round = (n: number, d: number) => Number(n.toFixed(d));
    return {
      priceNow: round(r.priceNow, 4),
      priceLower: round(r.priceLower, 4),
      priceUpper: round(r.priceUpper, 4),
      tickLower: r.tickLower,
      tickUpper: r.tickUpper,
      baseAmount: r.deposit ? round(r.deposit.baseAmount, 6) : null,
      quoteAmount: r.deposit ? round(r.deposit.quoteAmount, 2) : null,
      baseSharePercent: r.deposit ? round(r.deposit.baseShare * 100, 2) : null,
    };
  },
};

// two results side by side, since an answer template cannot do arithmetic of its own
const compareTwo: BlockSpec = {
  id: "compare-two",
  summary: "Which of two numbers is higher, and by how much.",
  inputs: {
    first: { type: "number", required: true, description: "first number" },
    second: { type: "number", required: true, description: "second number" },
    firstLabel: { type: "text", required: false, description: "name of the first; defaults to the first" },
    secondLabel: { type: "text", required: false, description: "name of the second; defaults to the second" },
  },
  outputs: {
    higher: { type: "text", description: "label of the higher one, or equal" },
    difference: { type: "number", description: "the higher minus the lower" },
  },
  check(a) {
    const problems: string[] = [];
    if (!finite(a.first)) problems.push("first must be a number");
    if (!finite(a.second)) problems.push("second must be a number");
    return problems;
  },
  run(a) {
    const x = num(a.first);
    const y = num(a.second);
    return {
      higher: x === y ? "equal" : x > y ? text(a.firstLabel, "the first") : text(a.secondLabel, "the second"),
      difference: Number(Math.abs(x - y).toFixed(4)),
    };
  },
};

export const BLOCKS: Record<string, BlockSpec> = Object.fromEntries(
  [healthFactor, netYield, gridLadder, driftCheck, liquidityRange, compareTwo].map((b) => [b.id, b]),
);

// a name from a blueprint is looked up as an own key only, so "constructor" or "toString"
// finds nothing where a plain lookup would find the object's inherited members
export function own<T>(record: Record<string, T>, key: unknown): T | undefined {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function getBlock(id: unknown): BlockSpec | undefined {
  return own(BLOCKS, id);
}

export function getSource(id: unknown): DataSourceSpec | undefined {
  return own(DATA_SOURCES, id);
}

export const DATA_SOURCES: Record<string, DataSourceSpec> = {
  "pancakeswap.v3.pool": {
    id: "pancakeswap.v3.pool",
    summary: "The deepest PancakeSwap v3 pool for a pair such as WBNB/USDT, read at one block: its price and what a range needs.",
    args: { pair: { type: "text", required: true, description: "base/quote, for example WBNB/USDT" } },
    outputs: {
      price: { type: "number", description: "quote per base at the block read" },
      feeTier: { type: "number", description: "the pool's fee tier" },
      blockNumber: { type: "number", description: "the block the pool was read at" },
      pool: { type: "text", description: "the pool's address" },
    },
    record: "pool",
  },
};
