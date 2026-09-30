// a concentrated liquidity range around a v3 pool's price: the ticks a position would
// use, aligned to the pool's spacing, the exact prices at those ticks, how a deposit
// splits between the two tokens, and a PancakeSwap link that opens with the range set.
// Pure arithmetic on what the pool reported; nothing here reads or writes a chain.

// PancakeSwap's spacing per fee tier, used only when the pool's own figure is missing
export const DEFAULT_TICK_SPACING: Record<number, number> = { 100: 1, 500: 10, 2500: 50, 10000: 200 };

const LOG_BASE = Math.log(1.0001);

export interface RangeInput {
  sqrtPriceX96: bigint;
  tickSpacing: number;
  decimals0: number;
  decimals1: number;
  // the base token is the one priced, as in WBNB priced in USDT
  baseIsToken0: boolean;
  widthPct: number;
  // optional deposit, valued in the quote token
  depositQuote?: number;
}

export interface RangeSuggestion {
  tickLower: number;
  tickUpper: number;
  // quote per base, at the aligned ticks and at the pool now
  priceLower: number;
  priceUpper: number;
  priceNow: number;
  inRange: boolean;
  // for the deposit, when one was given: how much of each token it takes
  deposit?: { quote: number; baseAmount: number; quoteAmount: number; baseShare: number };
}

// raw token1 per raw token0 at a tick, and back again
const rawAtTick = (tick: number): number => Math.pow(1.0001, tick);
const tickAtRaw = (raw: number): number => Math.log(raw) / LOG_BASE;

export function suggestRange(input: RangeInput): RangeSuggestion {
  const { tickSpacing, decimals0, decimals1, baseIsToken0, widthPct } = input;
  const scale = Math.pow(10, decimals0 - decimals1);
  const sqrtNow = Number(input.sqrtPriceX96) / 2 ** 96;
  const rawNow = sqrtNow * sqrtNow;
  // quote per base from raw token1 per raw token0, turned around when the base is token1
  const toBasePrice = (raw: number): number => (baseIsToken0 ? raw * scale : 1 / (raw * scale));
  const priceNow = toBasePrice(rawNow);

  const lowWanted = priceNow * (1 - widthPct / 200);
  const highWanted = priceNow * (1 + widthPct / 200);
  // a higher base price is a higher tick when the base is token0, a lower one when it is token1
  const rawLowWanted = baseIsToken0 ? lowWanted / scale : 1 / (highWanted * scale);
  const rawHighWanted = baseIsToken0 ? highWanted / scale : 1 / (lowWanted * scale);
  const tickLower = Math.floor(tickAtRaw(rawLowWanted) / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil(tickAtRaw(rawHighWanted) / tickSpacing) * tickSpacing;

  const a = toBasePrice(rawAtTick(tickLower));
  const b = toBasePrice(rawAtTick(tickUpper));
  const priceLower = Math.min(a, b);
  const priceUpper = Math.max(a, b);
  const sqrtA = Math.sqrt(rawAtTick(tickLower));
  const sqrtB = Math.sqrt(rawAtTick(tickUpper));
  const inRange = sqrtNow > sqrtA && sqrtNow < sqrtB;

  const out: RangeSuggestion = { tickLower, tickUpper, priceLower, priceUpper, priceNow, inRange };
  if (input.depositQuote !== undefined && input.depositQuote > 0) {
    // token amounts for one unit of liquidity, clipped to the range when the price sits outside it
    const sp = Math.min(Math.max(sqrtNow, sqrtA), sqrtB);
    const amount0 = (sqrtB - sp) / (sp * sqrtB) / Math.pow(10, decimals0);
    const amount1 = (sp - sqrtA) / Math.pow(10, decimals1);
    const baseUnit = baseIsToken0 ? amount0 : amount1;
    const quoteUnit = baseIsToken0 ? amount1 : amount0;
    const unitValue = quoteUnit + baseUnit * priceNow;
    const k = unitValue > 0 ? input.depositQuote / unitValue : 0;
    const baseAmount = baseUnit * k;
    const quoteAmount = quoteUnit * k;
    out.deposit = {
      quote: input.depositQuote,
      baseAmount,
      quoteAmount,
      baseShare: input.depositQuote > 0 ? (baseAmount * priceNow) / input.depositQuote : 0,
    };
  }
  return out;
}

// PancakeSwap's add-liquidity page reads the pair, the tier and the price bounds from the
// url; with the base token first the bounds are quote per base, and it snaps them to ticks
export function pancakeAddLiquidityUrl(opts: {
  chainId: number;
  base: string;
  quote: string;
  feeTier: number;
  priceLower: number;
  priceUpper: number;
}): string {
  const chain = opts.chainId === 97 ? "bscTestnet" : "bsc";
  // written out in full: toPrecision turns extreme prices into exponent form
  const plain = (n: number) => n.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 8 });
  const q = new URLSearchParams({
    chain,
    minPrice: plain(opts.priceLower),
    maxPrice: plain(opts.priceUpper),
  });
  return `https://pancakeswap.finance/add/${opts.base}/${opts.quote}/${opts.feeTier}?${q.toString()}`;
}
