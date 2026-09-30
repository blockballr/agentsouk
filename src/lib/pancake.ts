// PancakeSwap v3 on BNB Chain, the pure half: which tokens a pair may name and how a
// pool's price is read from its sqrtPriceX96. Addresses come from PancakeSwap's
// developer docs and were each read back on chain on 30 Sep 2026 (symbol and decimals).

export const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const; // same on 56 and 97

// fee tiers in hundredths of a basis point: 100 is 0.01%, 500 is 0.05%
export const PANCAKE_FEE_TIERS = [100, 500, 2500, 10000] as const;

export interface PancakeToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

const TOKENS: Record<number, Record<string, PancakeToken>> = {
  56: {
    WBNB: { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
    USDT: { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  },
  97: {
    WBNB: { symbol: "WBNB", address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", decimals: 18 },
    USDT: { symbol: "USDT", address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", decimals: 18 },
  },
};

// a grid is priced in dollars, so the second token of a pair must be a dollar stable
const USD_QUOTES = new Set(["USDT"]);

// BNB is read as WBNB, the token the pools actually hold
const ALIASES: Record<string, string> = { BNB: "WBNB" };

export function pancakeToken(chainId: number, symbol: string): PancakeToken | null {
  const key = symbol.toUpperCase();
  return TOKENS[chainId]?.[ALIASES[key] ?? key] ?? null;
}

export function isUsdQuote(symbol: string): boolean {
  return USD_QUOTES.has(symbol.toUpperCase());
}

export function supportedPairs(chainId: number): string[] {
  const symbols = Object.keys(TOKENS[chainId] ?? {});
  return symbols.flatMap((a) => symbols.filter((b) => b !== a && isUsdQuote(b)).map((b) => `${a}/${b}`));
}

// "WBNB/USDT", "bnb-usdt" or "BNB / USDT": the first symbol is priced in the second
export function parsePair(text: string): { base: string; quote: string } | null {
  const m = /\b(W?BNB|USDT)\s*[/-]\s*(W?BNB|USDT)\b/i.exec(text);
  if (!m) return null;
  const base = ALIASES[m[1].toUpperCase()] ?? m[1].toUpperCase();
  const quote = ALIASES[m[2].toUpperCase()] ?? m[2].toUpperCase();
  return base === quote ? null : { base, quote };
}

// token1 per token0 is (sqrtPriceX96 / 2^96)^2 scaled by the decimals gap; the pool
// orders its tokens by address, so a base that sorts second is inverted
export function priceFromSqrt(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
  baseIsToken0: boolean,
): number {
  // 36 digits of headroom keep a tiny ratio, such as 18 decimals against 6, from flooring to zero
  const precision = BigInt(10) ** BigInt(36);
  const numerator = sqrtPriceX96 * sqrtPriceX96 * precision * BigInt(10) ** BigInt(decimals0);
  const denominator = (BigInt(1) << BigInt(192)) * BigInt(10) ** BigInt(decimals1);
  const token1PerToken0 = Number(numerator / denominator) / 1e36;
  if (!(token1PerToken0 > 0)) return 0;
  return baseIsToken0 ? token1PerToken0 : 1 / token1PerToken0;
}

export function sortsFirst(a: string, b: string): boolean {
  return a.toLowerCase() < b.toLowerCase();
}

export function feeTierLabel(feeTier: number): string {
  return `${feeTier / 10000}%`;
}

export function chainName(chainId: number): string {
  return chainId === 56 ? "BNB Chain mainnet" : chainId === 97 ? "BSC testnet" : `chain ${chainId}`;
}
