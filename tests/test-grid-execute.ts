// A fill is authorised by a settled hire, never by the caller's say-so. Each refusal
// must name the reason the caller is told, or a real limit reads as a typo and gets
// worked around.

import { describe, expect, it } from "vitest";
import { authoriseRungFill, ladderFits, ladderBudgetUsd } from "../src/lib/grid-execute";
import type { HireAuthorisation } from "../src/lib/grid-execute";

const HIRE: HireAuthorisation = {
  paymentId: "pay_abc",
  client: "0xbuyer",
  symbol: "sUSD",
  spendCapUsd: 100,
};

function req(over: Partial<Parameters<typeof authoriseRungFill>[0]> = {}) {
  return authoriseRungFill({
    authorisation: HIRE,
    side: "sell",
    rungUsd: 600,
    orderSizeUsd: 100,
    feeBps: 25,
    maxSlippageBps: 50,
    baseToken: "0xbase",
    quoteToken: "0xquote",
    ...over,
  });
}

describe("a fill is authorised by a settled hire", () => {
  it("returns the fill when the hire carries a cap and the rung fits", () => {
    const r = req();
    expect(r.ok).toBe(true);
    expect(r.fill?.referenceUsd).toBe(600);
  });

  it("refuses when there is no hire at all", () => {
    const r = req({ authorisation: undefined as unknown as HireAuthorisation });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no settled hire");
  });

  it("refuses a hire with no payment id, which is not a settled hire", () => {
    const r = req({ authorisation: { ...HIRE, paymentId: "" } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no settled hire");
  });

  it("refuses a hire with no buyer wallet, since there is nobody to spend from", () => {
    const r = req({ authorisation: { ...HIRE, client: "" } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("buyer wallet");
  });

  it("refuses a hire with no spend cap, rather than treating it as unlimited", () => {
    const r = req({ authorisation: { ...HIRE, spendCapUsd: 0 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("spend cap");
  });

  it("refuses a negative cap, which would otherwise pass a positive comparison", () => {
    const r = req({ authorisation: { ...HIRE, spendCapUsd: -5 } });
    expect(r.ok).toBe(false);
  });
});

describe("the cap bounds the rung", () => {
  it("refuses a rung larger than the whole session", () => {
    const r = req({ orderSizeUsd: 101 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("caps the session at 100");
  });

  it("allows a rung exactly at the cap, since equal is within", () => {
    expect(req({ orderSizeUsd: 100 }).ok).toBe(true);
  });

  it("refuses a zero or negative order size", () => {
    expect(req({ orderSizeUsd: 0 }).ok).toBe(false);
    expect(req({ orderSizeUsd: -1 }).ok).toBe(false);
  });

  it("names both figures in the refusal, so the caller can see what to change", () => {
    const r = req({ orderSizeUsd: 250 });
    expect(r.reason).toContain("250");
    expect(r.reason).toContain("100");
  });
});

describe("the spot band is gone, so a wide ladder is not blocked", () => {
  // A band measured against the current price refuses exactly the rungs a DCA ladder
  // is waiting on, since a wide ladder keeps most of its rungs away from spot and
  // expects them to come due as price drifts. Validating a rung against the plan's
  // own declared range replaces it, and that belongs with the plan, not here.
  it("takes no spot figure at all", () => {
    const request = req();
    expect("spotUsd" in request).toBe(false);
  });

  it("accepts a rung far from any plausible current price", () => {
    // 350 and 1500 against a mainnet WBNB price near 770: both legitimate DCA legs.
    expect(req({ rungUsd: 350 }).ok).toBe(true);
    expect(req({ rungUsd: 1500 }).ok).toBe(true);
  });
});

describe("bad inputs are refused here, not at the router", () => {
  it("refuses a non-positive rung price", () => {
    expect(req({ rungUsd: 0 }).ok).toBe(false);
    expect(req({ rungUsd: Number.NaN }).ok).toBe(false);
  });

  it("refuses a basis point count at or above 10000, which buildRungFill would throw on", () => {
    const r = req({ feeBps: 10_000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("basis point");
  });

  it("carries the thrown reason through rather than swallowing it", () => {
    const r = req({ maxSlippageBps: -1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("maxSlippageBps");
  });

  it("leaves no fill behind on a refusal", () => {
    expect(req({ feeBps: 99_999 }).fill).toBeUndefined();
  });
});

describe("the floor comes from the rung, not from spot", () => {
  it("takes the floor from the rung on a buy, and not from anything live", () => {
    // A buy receives base, so its floor is in base units and does depend on the rung.
    // Two rungs give two floors, and both are the order at the rung less slippage.
    const high = req({ side: "buy", rungUsd: 600 }).fill?.amountOutMinimum;
    const low = req({ side: "buy", rungUsd: 400 }).fill?.amountOutMinimum;
    expect(high).not.toBe(low);
    const slippageFactor = 1 - 50 / 10_000;
    expect(high).toBeCloseTo((100 / 600) * slippageFactor, 6);
    expect(low).toBeCloseTo((100 / 400) * slippageFactor, 6);
  });

  it("leaves a sell floor independent of the rung, because a sell floor is in quote", () => {
    // The mirror, and the reason the case above had to be a buy. A sell receives quote,
    // so its floor is the order less slippage and the rung only sets amountIn. Asserting
    // that it moves would be wrong; asserting that it does not is what pins the units.
    const at600 = req({ side: "sell", rungUsd: 600 }).fill;
    const at400 = req({ side: "sell", rungUsd: 400 }).fill;
    expect(at400?.amountOutMinimum).toBe(at600?.amountOutMinimum);
    // The rung does reach the input, which is why the sell floor is blind to it.
    expect(at400?.amountIn).not.toBe(at600?.amountIn);
  });

  it("charges the pool fee once, so the floor is the order less slippage", () => {
    // The fee comes out of amountIn, so the quote received is the order itself.
    expect(req({ side: "sell" }).fill?.amountOutMinimum).toBeCloseTo(100 * (1 - 50 / 10_000), 4);
  });
});

describe("the cap bounds the whole ladder, not each rung", () => {
  it("sums the rungs", () => {
    expect(ladderBudgetUsd([10, 20, 30], 1000)).toBe(60);
  });

  it("never exceeds the session cap however many rungs there are", () => {
    expect(ladderBudgetUsd([100, 100, 100], 100)).toBe(100);
  });

  it("refuses a ladder of ten rungs at the cap, which is ten times the session", () => {
    expect(ladderFits([100, 100, 100, 100, 100, 100, 100, 100, 100, 100], 100)).toBe(false);
  });

  it("accepts a ladder that fits", () => {
    expect(ladderFits([10, 20, 30], 100)).toBe(true);
    expect(ladderFits([50, 50], 100)).toBe(true);
  });

  it("ignores junk rung sizes rather than letting NaN poison the total", () => {
    expect(ladderBudgetUsd([10, Number.NaN, 20], 1000)).toBe(30);
    expect(ladderBudgetUsd([10, -5, 20], 1000)).toBe(30);
    expect(ladderFits([Number.NaN], 100)).toBe(false);
  });

  it("is zero and does not fit without a cap, rather than being unlimited", () => {
    expect(ladderBudgetUsd([10, 10], 0)).toBe(0);
    expect(ladderFits([10, 10], 0)).toBe(false);
  });
});
