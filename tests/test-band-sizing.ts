// The band's move is a value, the vault spends tokens. Both sides are checked
// against the same 737 USDT per WBNB mark so a sale cannot ask for more WBNB
// than the hire holds.
import { describe, expect, it } from "vitest";
import { decideBand, type BandHireFacts, type BandPolicy } from "../src/lib/band-policy";

const NOW = 1_900_000_000;
const PRICE = 737;
const E18 = 1_000_000_000_000_000_000n;

const POLICY: BandPolicy = {
  widthPct: 5,
  minDriftPct: 1,
  maxCostRatio: 0.5,
  maxSlippageBps: 100,
};

function hire(over: Partial<BandHireFacts> = {}): BandHireFacts {
  return {
    id: 1n,
    open: true,
    expiry: NOW + 3600,
    balanceA: 1n * E18,
    balanceB: 0n,
    refPriceX96: 0n,
    targetWeightA: 50,
    maxSlippageBps: 100,
    ...over,
  };
}

function decide(facts: BandHireFacts) {
  return decideBand({
    hire: facts,
    policy: POLICY,
    state: null,
    price: PRICE,
    blockNumber: 100n,
    nowSec: NOW,
    kill: false,
  });
}

describe("band sizing", () => {
  it("sells the overweight A side in token units, not in value", () => {
    // 1 WBNB against no USDT is 100 percent A. half the drift back to target is
    // a quarter of the value, which is 0.25 WBNB, never 184 WBNB.
    const out = decide(hire());
    expect(out.action).toBe("trade");
    if (out.action !== "trade") return;
    expect(out.intents[0].side).toBe("sellA");
    expect(out.intents[0].tokenInSide).toBe("A");
    expect(out.intents[0].amountIn).toBe(E18 / 4n);
    expect(out.intents[0].amountIn).toBeLessThanOrEqual(hire().balanceA);
  });

  it("buys the underweight A side with the quote amount the move is worth", () => {
    const out = decide(hire({ balanceA: 0n, balanceB: 737n * E18 }));
    expect(out.action).toBe("trade");
    if (out.action !== "trade") return;
    expect(out.intents[0].side).toBe("buyA");
    expect(out.intents[0].tokenInSide).toBe("B");
    // a quarter of 737 USDT of value, spent as USDT
    expect(out.intents[0].amountIn).toBe((737n * E18) / 4n);
  });

  it("refuses to size anything without a positive price", () => {
    const out = decideBand({
      hire: hire(),
      policy: POLICY,
      state: null,
      price: 0,
      blockNumber: 100n,
      nowSec: NOW,
      kill: false,
    });
    expect(out.action).toBe("stop");
  });
});
