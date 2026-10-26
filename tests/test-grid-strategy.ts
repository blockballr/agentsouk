// The strategy layer decides without reading or sending: every branch a hire can
// be in, the size a rung takes, the idempotency that keeps one crossing one
// trade, the re-centre that keeps a static grid out of a trend, and the kill
// switch that turns the next decision into a no-op.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY_LEVELS,
  DEFAULT_STRATEGY_WIDTH_PCT,
  decideHire,
  ladderRungs,
  policyFromEnv,
  refQuotePerBase,
  type HireFacts,
  type StrategyPolicy,
  type StrategyState,
} from "../src/lib/grid-strategy";

const POLICY: StrategyPolicy = { widthPct: 10, levels: 11, spacing: "geometric", centerWeighted: false, volatilityAdjusted: false };
const Q96 = 2n ** 96n;
const NOW = 1_900_000_000;

function hire(over: Partial<HireFacts> = {}): HireFacts {
  return {
    id: 1n,
    open: true,
    expiry: NOW + 3600,
    balanceA: 110n,
    balanceB: 110n,
    // the reference on the same scale as the price read, quote per base
    refQuotePerBase: 600,
    depositInToken0: 1n,
    maxSlippageBps: 100,
    ...over,
  };
}

function state(over: Partial<StrategyState> = {}): StrategyState {
  return { generation: 0, lastBlock: 100n, lastPrice: 600, crossed: [], ...over };
}

function base(over: Partial<Parameters<typeof decideHire>[0]> = {}) {
  return decideHire({
    hire: hire(),
    policy: POLICY,
    state: state(),
    price: 600,
    blockNumber: 200n,
    nowSec: NOW,
    kill: false,
    ...over,
  });
}

describe("ladder geometry", () => {
  it("spans the band in equal steps around the reference", () => {
    const rungs = ladderRungs(600, POLICY);
    expect(rungs).toHaveLength(DEFAULT_STRATEGY_LEVELS);
    expect(rungs[0]).toBeCloseTo(570);
    expect(rungs[5]).toBeCloseTo(600);
    expect(rungs[10]).toBeCloseTo(630);
    for (let i = 1; i < rungs.length; i += 1) {
      expect(rungs[i] - rungs[i - 1]).toBeCloseTo(rungs[1] - rungs[0]);
    }
  });
});

describe("the price axis", () => {
  it("normalises token1 per token0 to quote per base when the base is token1", () => {
    const raw = Q96 / 737n;
    expect(refQuotePerBase(raw, false)).toBeCloseTo(737, 6);
    expect(refQuotePerBase(raw, true)).toBeCloseTo(1 / 737, 10);
  });

  it("holds at the live ordering instead of recentring every pass", () => {
    // USDT is token0 on both chains, so the stored reference is WBNB per USDT
    // while the price read is USDT per WBNB. once normalised, a grid sitting at
    // its reference has no reason to trade.
    const out = decideHire({
      hire: hire({ refQuotePerBase: 737 }),
      policy: POLICY,
      state: state({ lastPrice: 737 }),
      price: 737,
      blockNumber: 200n,
      nowSec: NOW,
      kill: false,
    });
    expect(out.action).toBe("hold");
  });
});

describe("policy from the environment", () => {
  it("defaults when unset or absurd", () => {
    expect(policyFromEnv({})).toMatchObject({
      widthPct: DEFAULT_STRATEGY_WIDTH_PCT,
      levels: DEFAULT_STRATEGY_LEVELS,
    });
    expect(policyFromEnv({ GRID_STRATEGY_WIDTH_PCT: "0", GRID_STRATEGY_LEVELS: "1" })).toMatchObject({
      widthPct: DEFAULT_STRATEGY_WIDTH_PCT,
      levels: DEFAULT_STRATEGY_LEVELS,
    });
    expect(policyFromEnv({ GRID_STRATEGY_WIDTH_PCT: "nan", GRID_STRATEGY_LEVELS: "999" })).toMatchObject({
      widthPct: DEFAULT_STRATEGY_WIDTH_PCT,
      levels: DEFAULT_STRATEGY_LEVELS,
    });
  });

  it("honours values inside the bounds", () => {
    expect(policyFromEnv({ GRID_STRATEGY_WIDTH_PCT: "20", GRID_STRATEGY_LEVELS: "21" })).toMatchObject({
      widthPct: 20,
      levels: 21,
    });
  });
});

describe("stopping", () => {
  it("stops when the kill switch is thrown, before anything else", () => {
    const out = base({ kill: true, price: 640 });
    expect(out.action).toBe("stop");
    expect(out.reason).toContain("kill switch");
  });

  it("stops when the hire is not open or has expired", () => {
    expect(base({ hire: hire({ open: false }) }).action).toBe("stop");
    const expired = base({ hire: hire({ expiry: NOW }) });
    expect(expired.action).toBe("stop");
    expect(expired.reason).toContain("expired");
  });

  it("stops when the reference or the price read is not a positive number", () => {
    expect(base({ hire: hire({ refQuotePerBase: 0 }) }).action).toBe("stop");
    expect(base({ price: 0 }).action).toBe("stop");
  });
});

describe("holding", () => {
  it("never decides the same block twice", () => {
    const out = base({ state: state({ lastBlock: 200n }), price: 594 });
    expect(out.action).toBe("hold");
    expect(out.reason).toContain("already decided");
  });

  it("arms on the first pass without crossing anything", () => {
    const out = base({ state: null, price: 590 });
    expect(out.action).toBe("hold");
    expect(out.state.lastPrice).toBe(590);
    expect(out.state.lastBlock).toBe(200n);
  });

  it("holds when the price stays inside the band and crosses nothing", () => {
    const out = base({ state: state({ lastPrice: 597 }), price: 596 });
    expect(out.action).toBe("hold");
    expect(out.reason).toContain("no rung between");
    expect(out.state.lastPrice).toBe(596);
  });
});

describe("crossing rungs", () => {
  it("buys base on a fall through rungs, one intent per rung at the plan's size", () => {
    const out = base({ state: state({ lastPrice: 620 }), price: 590 });
    expect(out.action).toBe("trade");
    if (out.action !== "trade") return;
    // rungs strictly below 620 and at or above 590: 594, 600, 606, 612, 618
    out.intents.forEach((intent, i) => expect(intent.rungPrice).toBeCloseTo([594, 600, 606, 612, 618][i]));
    for (const intent of out.intents) {
      expect(intent.side).toBe("buyA");
      expect(intent.tokenInSide).toBe("B");
      expect(intent.amountIn).toBe(10n); // 110 of side B across 11 rungs
    }
    expect(out.state.crossed).toHaveLength(5);
    expect(out.state.lastBlock).toBe(200n);
  });

  it("sells base on a rise through rungs", () => {
    const out = base({ state: state({ lastPrice: 590 }), price: 620 });
    expect(out.action).toBe("trade");
    if (out.action !== "trade") return;
    expect(out.intents.every((i) => i.side === "sellA" && i.tokenInSide === "A")).toBe(true);
    expect(out.intents).toHaveLength(5);
  });

  it("never fires the same crossing twice", () => {
    const crossed = ["0:4:buyA", "0:5:buyA", "0:6:buyA", "0:7:buyA", "0:8:buyA"];
    const out = base({ state: state({ lastPrice: 620, crossed }), price: 590 });
    expect(out.action).toBe("hold");
    if (out.action !== "hold") return;
    expect(out.reason).toContain("already acted");
  });

  it("holds when the side that should sell holds nothing", () => {
    const out = base({ hire: hire({ balanceA: 0n }), state: state({ lastPrice: 590 }), price: 620 });
    expect(out.action).toBe("hold");
  });

  it("sizes to the side's balance divided across the ladder", () => {
    const out = base({
      hire: hire({ balanceB: 55n }),
      state: state({ lastPrice: 620 }),
      price: 590,
    });
    if (out.action !== "trade") return;
    for (const intent of out.intents) expect(intent.amountIn).toBe(5n);
  });
});

describe("re-centring", () => {
  it("rebuilds around the price that left the band and steps toward the centre", () => {
    const out = base({ price: 640 });
    expect(out.action).toBe("trade");
    if (out.action !== "trade") return;
    expect(out.state.generation).toBe(1);
    expect(out.reason).toContain("recentred");
    // above the band the hire sits in quote, so the step buys base at the rung
    // nearest the new centre
    expect(out.intents).toHaveLength(1);
    expect(out.intents[0].side).toBe("buyA");
    expect(out.intents[0].rungPrice).toBeCloseTo(640);
    expect(out.intents[0].amountIn).toBe(10n);
  });

  it("steps the other way when the price fell out below", () => {
    const out = base({ price: 550 });
    if (out.action !== "trade") return;
    expect(out.state.generation).toBe(1);
    expect(out.intents[0].side).toBe("sellA");
    expect(out.intents[0].tokenInSide).toBe("A");
    expect(out.intents[0].amountIn).toBe(10n);
  });
});
