// The page prices the round trip from the pool it will trade, so the quote per
// base has to match the vault's own scale. Both orderings are covered because
// the live pair puts USDT in token0 while a test fixture often does not.
import { describe, expect, it } from "vitest";
import { quotePerBase } from "../apps/web/src/lib/vault";

const Q96 = 1n << 96n;

describe("quotePerBase", () => {
  it("reads a 1:1 pool as 1", () => {
    expect(quotePerBase(Q96, true)).toBeCloseTo(1, 12);
    expect(quotePerBase(Q96, false)).toBeCloseTo(1, 12);
  });

  it("reads the live ordering where the base is token1", () => {
    // token1/token0 = 0.25, so one base (token1) is worth 4 quote (token0)
    expect(quotePerBase(Q96 / 2n, false)).toBeCloseTo(4, 9);
  });

  it("reads the fixture ordering where the base is token0", () => {
    // token1/token0 = 4, so one base (token0) is worth 4 quote (token1)
    expect(quotePerBase(Q96 * 2n, true)).toBeCloseTo(4, 9);
  });

  it("returns zero for an unread pool", () => {
    expect(quotePerBase(0n, true)).toBe(0);
  });
});
