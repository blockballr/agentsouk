// One rung of a planned grid, as a bounded swap. The ladder itself is planned by
// reference-grid.ts and stays deterministic; this turns a single rung into the
// numbers a router needs, so a fill cannot be looser than the rung the caller was
// shown.
//
// The floor comes from the rung price the plan published, never from a live quote.
// A live quote is the price the market is at when the agent chooses to trade, so
// using it would let a moved market fill worse than the plan without anyone
// noticing. Slippage widens the rung on purpose and can never narrow it.

/** Which way a rung sells. A ladder below spot buys the base, above it sells. */
export type RungSide = "buy" | "sell";

export interface RungFillInput {
  side: RungSide;
  /** the rung price the plan published, in USD per unit of the base token */
  rungUsd: number;
  /** the size of this rung, in USD */
  orderSizeUsd: number;
  /** the pool's swap fee in basis points, one way */
  feeBps: number;
  /** how far the market may move against this fill before it reverts */
  maxSlippageBps: number;
  /** token addresses for the pair, resolved by the caller */
  baseToken: string;
  quoteToken: string;
}

export interface RungFill {
  side: RungSide;
  tokenIn: string;
  tokenOut: string;
  /** the size of this rung expressed in tokenIn units */
  amountIn: number;
  /** the smallest acceptable tokenOut, the rung price less the slippage allowed */
  amountOutMinimum: number;
  /** the rung price this floor came from, kept so a caller can audit it */
  referenceUsd: number;
  feeBps: number;
  maxSlippageBps: number;
  baseToken: string;
  quoteToken: string;
}

/** Carried to six decimals so an 18-decimal integer can be built without drift. */
const DECIMALS = 6;

function assertBps(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 10_000) {
    throw new Error(`${name} must be a basis point count below 10000`);
  }
}

/**
 * Build the bounded swap for one rung. Throws rather than clamping: a caller that
 * cannot be given a real floor should not receive a fill that looks bounded and is
 * not.
 */
export function buildRungFill(input: RungFillInput): RungFill {
  if (!Number.isFinite(input.orderSizeUsd) || input.orderSizeUsd <= 0) {
    throw new Error("orderSizeUsd must be positive");
  }
  if (!Number.isFinite(input.rungUsd) || input.rungUsd <= 0) {
    throw new Error("rungUsd must be positive");
  }
  assertBps(input.feeBps, "feeBps");
  assertBps(input.maxSlippageBps, "maxSlippageBps");

  const feeFactor = 1 - input.feeBps / 10_000;
  const slippageFactor = 1 - input.maxSlippageBps / 10_000;
  const orderSizeUsd = input.orderSizeUsd;

  // Selling the base spends base and receives the quote; buying the base spends
  // the quote and receives base. The order is denominated in USD either way, so
  // both directions convert at the rung price.
  const tokenIn = input.side === "sell" ? input.baseToken : input.quoteToken;
  const tokenOut = input.side === "sell" ? input.quoteToken : input.baseToken;

  // The fee is taken from whatever goes in, so tokenIn is grossed up by it. The
  // pool receives orderSizeUsd net either way.
  //
  // UNITS. tokenIn and tokenOut are different tokens, so each figure below is in the
  // units of the token it is spent or received in, which is what a router expects.
  // This was the original defect: both figures were computed by dividing a USD amount
  // by the rung price, which lands in BASE units, so a sell proposed a floor roughly
  // rungUsd times too small. A floor that low cannot bite, so the swap would succeed
  // however far the market moved, which is the opposite of what this module is for.
  //
  //   sell  spend base, receive quote. amountIn is base, amountOutMinimum is quote.
  //         base worth orderSizeUsd is orderSizeUsd / rungUsd, grossed up for the fee
  //         because the fee comes out of the input. A V3 exact input swap deducts that fee
  //         from amountIn, so what comes back out is amountIn * feeFactor at the rung, which
  //         cancels the gross up exactly. The fee is therefore charged ONCE, in amountIn, and
  //         the received quote is orderSizeUsd, not orderSizeUsd * feeFactor. Charging it a
  //         second time here understated the floor by feeFactor, which is the same direction
  //         as the unit error this function was corrected for.
  //   buy   spend quote, receive base. amountIn is quote, amountOutMinimum is base.
  //         quote spent is orderSizeUsd. Base received is that quote at the rung, less
  //         the slippage allowed.
  let amountIn: number;
  let amountOutMinimum: number;
  if (input.side === "sell") {
    const baseSpent = orderSizeUsd / input.rungUsd;
    amountIn = baseSpent / feeFactor;
    const quoteReceived = baseSpent * input.rungUsd;
    amountOutMinimum = quoteReceived * slippageFactor;
  } else {
    amountIn = orderSizeUsd / feeFactor;
    const baseReceived = amountIn * feeFactor / input.rungUsd;
    amountOutMinimum = baseReceived * slippageFactor;
  }

  return {
    side: input.side,
    tokenIn,
    tokenOut,
    amountIn: Number(amountIn.toFixed(DECIMALS)),
    amountOutMinimum: Number(amountOutMinimum.toFixed(DECIMALS)),
    referenceUsd: input.rungUsd,
    feeBps: input.feeBps,
    maxSlippageBps: input.maxSlippageBps,
    baseToken: input.baseToken,
    quoteToken: input.quoteToken,
  };
}

/** Why a fill was refused, in terms a caller can act on rather than a revert. */
export type RungRefusal =
  | { ok: false; reason: "invalid_fill"; detail: string }
  | { ok: false; reason: "insufficient_allowance"; required: number; available: number };

/**
 * Check a fill against what the caller has actually approved before anything is
 * sent. An agent that discovers the shortfall on chain has already paid gas, so the
 * check happens first and reports the gap.
 */
export function authoriseRungFill(
  fill: RungFill,
  allowanceForTokenIn: number,
): RungRefusal | { ok: true; fill: RungFill } {
  if (!Number.isFinite(fill.amountIn) || fill.amountIn <= 0) {
    return { ok: false, reason: "invalid_fill", detail: "amountIn must be positive" };
  }
  if (allowanceForTokenIn < fill.amountIn) {
    return {
      ok: false,
      reason: "insufficient_allowance",
      required: fill.amountIn,
      available: allowanceForTokenIn,
    };
  }
  return { ok: true, fill };
}