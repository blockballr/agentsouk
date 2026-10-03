// The bounded rung a grid fill swaps on. What matters is that the floor comes
// from the rung the plan published rather than from a price read at trade time,
// because that is the difference between a bounded fill and one that follows the
// market wherever it moved.

import { describe, expect, it } from "vitest";
import { authoriseRungFill, buildRungFill } from "@/lib/grid-fill";

const BASE = "0x0000000000000000000000000000000000000b01";
const QUOTE = "0x0000000000000000000000000000000000000c01";
const FEE = 25; // PancakeSwap v3 five-hundredths tier is 5 bps; 25 is a deliberate worst case

function fill(over: Partial<Parameters<typeof buildRungFill>[0]> = {}) {
  return buildRungFill({
    side: "sell",
    rungUsd: 600,
    orderSizeUsd: 100,
    feeBps: FEE,
    maxSlippageBps: 50,
    baseToken: BASE,
    quoteToken: QUOTE,
    ...over,
  });
}

describe("a rung fill", () => {
  it("spends the base and receives the quote when selling", () => {
    const f = fill();
    expect(f.tokenIn).toBe(BASE);
    expect(f.tokenOut).toBe(QUOTE);
    expect(f.referenceUsd).toBe(600);
  });

  it("spends the quote and receives the base when buying", () => {
    const f = fill({ side: "buy" });
    expect(f.tokenIn).toBe(QUOTE);
    expect(f.tokenOut).toBe(BASE);
  });

  it("converts the USD order size at the rung price", () => {
    // 100 USD of a 600 USD token is 1/6 of a unit, grossed up for the fee
    expect(fill().amountIn).toBeCloseTo(100 / 600 / (1 - FEE / 10_000), 6);
  });

  it("states the floor in quote units, which is the unit the router expects", () => {
    // A sell receives quote, so amountOutMinimum is a quote figure. This assertion used to
    // divide the order by the rung again, which is the unit error itself: it produced a
    // floor 600x too small, one no market move could breach, and it passed anyway.
    const f = fill();
    const netUsd = 100 * (1 - FEE / 10_000);
    const slippageFactor = 1 - 50 / 10_000;

    // strictly under the net value of the order, in quote
    expect(f.amountOutMinimum).toBeLessThan(netUsd);
    // the exact figure the arithmetic implies, so a regression is visible rather than vague
    expect(f.amountOutMinimum).toBeCloseTo(netUsd * slippageFactor, 4);
    // and demonstrably not the base-unit equivalent the old code returned
    expect(f.amountOutMinimum).toBeGreaterThan(netUsd / 600);
  });

  it("states the floor in base units when buying, because a buy receives base", () => {
    // The mirror of the sell case, which is the half the original code also got wrong:
    // amountIn for a buy is quote and must not be divided by the rung.
    const b = fill({ side: "buy" });
    const netUsd = 100 * (1 - FEE / 10_000);
    expect(b.amountIn).toBeGreaterThan(99);
    expect(b.amountOutMinimum).toBeLessThan(netUsd / 600);
    expect(b.amountOutMinimum).toBeCloseTo((100 / 600) * (1 - 50 / 10_000), 6);
  });

  it("widens with the slippage the caller allows and narrows without it", () => {
    const tight = fill({ maxSlippageBps: 0 });
    const loose = fill({ maxSlippageBps: 200 });
    expect(loose.amountOutMinimum).toBeLessThan(tight.amountOutMinimum);
  });

  it("does not move when the market does, because the floor is the rung", () => {
    // the same rung filled twice is the same fill, which is the property a live
    // quote cannot offer
    expect(fill()).toEqual(fill());
  });

  it("refuses a fill it cannot bound", () => {
    expect(() => fill({ rungUsd: 0 })).toThrow(/rungUsd/);
    expect(() => fill({ orderSizeUsd: 0 })).toThrow(/orderSizeUsd/);
    expect(() => fill({ feeBps: 10_000 })).toThrow(/feeBps/);
    expect(() => fill({ maxSlippageBps: -1 })).toThrow(/maxSlippageBps/);
  });
});

describe("the allowance check", () => {
  it("passes when the approved amount covers the fill", () => {
    const f = fill();
    expect(authoriseRungFill(f, f.amountIn)).toEqual({ ok: true, fill: f });
  });

  it("reports the gap instead of failing on chain after gas", () => {
    const f = fill();
    const verdict = authoriseRungFill(f, f.amountIn / 2);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok && verdict.reason === "insufficient_allowance") {
      expect(verdict.required).toBe(f.amountIn);
      expect(verdict.available).toBe(f.amountIn / 2);
    } else {
      throw new Error("expected an allowance shortfall");
    }
  });

  it("refuses a fill with nothing to spend", () => {
    expect(authoriseRungFill(fill(), 0).ok).toBe(false);
  });
});