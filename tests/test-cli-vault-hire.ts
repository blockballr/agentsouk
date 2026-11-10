// The vault hire is a spend path, so its arithmetic is tested apart from the
// chain: the token choice, the term, the caps and the fee pick.
import { describe, expect, it } from "vitest";
import {
  expiryFor,
  gasCost,
  percentToBps,
  pickFeeTier,
  quotePerBase,
  tokenFor,
  type FeeChoice,
} from "../packages/cli/src/marketplace/vault-hire";

const pool = "0x1111111111111111111111111111111111111111" as const;

function tier(fee: number, liquidity: bigint, twapOk = true): FeeChoice {
  return { fee, pool, liquidity, twapOk, price: null };
}

describe("the bound token pair", () => {
  it("resolves the pair by name and by address", () => {
    expect(tokenFor(56, undefined).symbol).toBe("WBNB");
    expect(tokenFor(56, "wbnb").symbol).toBe("WBNB");
    expect(tokenFor(56, "USDT").symbol).toBe("USDT");
    expect(tokenFor(56, "0x55d398326f99059fF775485246999027B3197955").symbol).toBe("USDT");
  });

  it("refuses a token the vault does not hold", () => {
    expect(() => tokenFor(56, "0x1111111111111111111111111111111111111111")).toThrow(/bound tokens/);
    expect(() => tokenFor(999, "wbnb")).toThrow(/no vault token pair/);
  });
});

describe("the term", () => {
  it("is one day by default and capped at 90", () => {
    const now = 1_800_000_000;
    expect(expiryFor(undefined, now)).toBe(now + 86_400 - 60);
    expect(expiryFor("7", now)).toBe(now + 7 * 86_400 - 60);
    expect(expiryFor("90", now)).toBe(now + 90 * 86_400 - 60);
  });

  it("refuses a term outside the contract's horizon", () => {
    for (const days of ["0", "91", "1.5", "-1", "x"]) {
      expect(() => expiryFor(days), days).toThrow(/1 to 90 days/);
    }
  });
});

describe("percent fields", () => {
  it("turns a percent into basis points", () => {
    expect(percentToBps("5", 500, "slippage")).toBe(500);
    expect(percentToBps("0.01", 0, "slippage")).toBe(1);
    expect(percentToBps(undefined, 20, "max loss")).toBe(2000);
  });

  it("refuses a negative or non-numeric percent", () => {
    expect(() => percentToBps("-1", 0, "fee")).toThrow(/positive percent/);
    expect(() => percentToBps("abc", 0, "fee")).toThrow(/positive percent/);
  });
});

describe("the fee tier", () => {
  it("takes the highest-liquidity tier with price history", () => {
    const options = [tier(100, 10n), tier(500, 300n), tier(2500, 200n), tier(10000, 900n, false)];
    expect(pickFeeTier(options).fee).toBe(500);
  });

  it("honours an explicit tier", () => {
    expect(pickFeeTier([tier(100, 10n), tier(500, 300n)], "500")).toMatchObject({ fee: 500 });
    expect(() => pickFeeTier([tier(100, 10n)], "500")).toThrow(/no pool/);
    expect(() => pickFeeTier([tier(500, 10n, false)], "500")).toThrow(/no price history/);
  });

  it("refuses when no tier can be priced", () => {
    expect(() => pickFeeTier([tier(100, 10n, false)])).toThrow(/no pool for this pair/);
  });
});

describe("the pool price", () => {
  it("reads one token per token at price 1", () => {
    const sqrtPriceX96 = 1n << 96n;
    expect(quotePerBase(sqrtPriceX96, true)).toBeCloseTo(1, 12);
    expect(quotePerBase(sqrtPriceX96, false)).toBeCloseTo(1, 12);
  });

  it("answers zero for an empty pool", () => {
    expect(quotePerBase(0n, true)).toBe(0);
  });
});

describe("gas in BNB", () => {
  it("multiplies gas by the price", () => {
    expect(gasCost(100_000n, 50_000_000n)).toBe("0.000005 BNB");
    expect(gasCost(null, 1n)).toBe("-");
  });
});
