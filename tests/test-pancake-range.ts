// a suggested v3 range around a pool's price: ticks aligned to the pool's spacing and
// straddling the price, the prices at those ticks, a deposit split that adds back up,
// and the PancakeSwap link that opens with the range set
import { describe, expect, it } from "vitest";
import { pancakeAddLiquidityUrl, suggestRange } from "../src/lib/pancake-range";

// WBNB/USDT 0.05% on BSC testnet; USDT sorts first, so WBNB, the base, is token1
const SQRT = BigInt("25198607551688324341071279158");
const PRICE = 1 / (Number(SQRT) / 2 ** 96) ** 2;

describe("suggested PancakeSwap range", () => {
  const r = suggestRange({ sqrtPriceX96: SQRT, tickSpacing: 10, decimals0: 18, decimals1: 18, baseIsToken0: false, widthPct: 10, depositQuote: 100 });

  it("reads the base price and straddles it with ticks on the pool's spacing", () => {
    expect(r.priceNow).toBeCloseTo(PRICE, 8);
    expect(Number.isInteger(r.tickLower / 10)).toBe(true);
    expect(Number.isInteger(r.tickUpper / 10)).toBe(true);
    expect(r.tickLower).toBeLessThan(r.tickUpper);
    expect(r.inRange).toBe(true);
    expect(r.priceLower).toBeLessThan(r.priceNow);
    expect(r.priceUpper).toBeGreaterThan(r.priceNow);
  });

  it("widens rather than narrows the asked range when aligning, by no more than a tick step", () => {
    expect(r.priceLower).toBeLessThanOrEqual(PRICE * 0.95 + 1e-9);
    expect(r.priceUpper).toBeGreaterThanOrEqual(PRICE * 1.05 - 1e-9);
    const step = Math.pow(1.0001, 10);
    expect(r.priceLower).toBeGreaterThan((PRICE * 0.95) / step);
    expect(r.priceUpper).toBeLessThan(PRICE * 1.05 * step);
  });

  it("splits the deposit so the two sides add back to it at today's price", () => {
    const d = r.deposit!;
    expect(d.quoteAmount + d.baseAmount * r.priceNow).toBeCloseTo(100, 6);
    // centred on the price, a v3 position holds close to half of each side
    expect(d.baseShare).toBeGreaterThan(0.45);
    expect(d.baseShare).toBeLessThan(0.55);
  });

  it("gives the same prices whichever token is base, once turned around", () => {
    const flipped = suggestRange({ sqrtPriceX96: SQRT, tickSpacing: 10, decimals0: 18, decimals1: 18, baseIsToken0: true, widthPct: 10 });
    expect(flipped.priceNow).toBeCloseTo(1 / PRICE, 10);
    expect(Number.isInteger(flipped.tickLower / 10)).toBe(true);
    expect(flipped.priceLower).toBeLessThan(flipped.priceNow);
  });

  it("builds the add-liquidity link with the base first, as PancakeSwap reads it", () => {
    const url = pancakeAddLiquidityUrl({
      chainId: 97,
      base: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
      quote: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
      feeTier: 500,
      priceLower: 9.4016812,
      priceUpper: 10.400812,
    });
    expect(url).toBe(
      "https://pancakeswap.finance/add/0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd/0x337610d27c682E347C9cD60BD4b3b107C9d34dDd/500?chain=bscTestnet&minPrice=9.4016812&maxPrice=10.400812",
    );
  });

  it("writes extreme prices out in full rather than in exponent form", () => {
    const url = new URL(
      pancakeAddLiquidityUrl({ chainId: 56, base: "0xa", quote: "0xb", feeTier: 100, priceLower: 1.23456789e-10, priceUpper: 1.2e22 }),
    );
    expect(url.searchParams.get("minPrice")).toBe("0.00000000012345679");
    expect(url.searchParams.get("maxPrice")).toBe("12000000000000000000000");
  });
});
