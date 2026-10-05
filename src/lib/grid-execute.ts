// The seam between a settled hire and a bounded rung fill. A hire settles before a task
// runs, so the receipt is what authorises spending and there is no standing key on a
// funded account for anyone to reach. Nothing here holds a key or signs.

import { buildRungFill, type RungFill, type RungSide } from "./grid-fill";

/** A subset of Receipt from x402.ts, namely what authorises a spend. */
export interface HireAuthorisation {
  paymentId: string;
  client: string;
  symbol: string;
  /** from receipt.session.spendCapUsd, in USD */
  spendCapUsd: number;
}

export interface RungRequest {
  authorisation: HireAuthorisation;
  side: RungSide;
  /** the rung price the plan published, in USD per unit of the base token */
  rungUsd: number;
  orderSizeUsd: number;
  feeBps: number;
  maxSlippageBps: number;
  baseToken: string;
  quoteToken: string;
  /** the range the plan declared, when it came from one */
  rangeUsd?: { lowerUsd: number; upperUsd: number };
}

export interface RungAuthorisation {
  ok: boolean;
  fill?: RungFill;
  /** present only when ok is false */
  reason?: string;
}


function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * A rung is checked against the range the plan declared, not against the market.
 *
 * This replaces a spot band, which refused exactly the rungs a dollar cost averaging
 * ladder waits on: a wide ladder keeps most of its rungs away from the current price and
 * expects price to drift to them over weeks. Comparing the rung against the plan catches the
 * case the band was for, a rung from a stale plan or the wrong pair, because such a rung
 * falls outside the range the caller published.
 */
function checkRange(
  rungUsd: number,
  range: { lowerUsd: number; upperUsd: number } | undefined,
): { ok: boolean; reason?: string } {
  if (!range) return { ok: true };
  const { lowerUsd, upperUsd } = range;
  if (!isPositive(lowerUsd) || !isPositive(upperUsd)) {
    return { ok: false, reason: "the declared range is not two positive prices" };
  }
  if (upperUsd <= lowerUsd) {
    return { ok: false, reason: "the declared range does not rise" };
  }
  if (rungUsd < lowerUsd || rungUsd > upperUsd) {
    return {
      ok: false,
      reason: `rung at ${rungUsd} USD is outside the ${lowerUsd} to ${upperUsd} USD range the plan declared`,
    };
  }
  return { ok: true };
}

export function authoriseRungFill(request: RungRequest): RungAuthorisation {
  const { authorisation, side, rungUsd, orderSizeUsd, feeBps, maxSlippageBps, baseToken, quoteToken } = request;

  if (!authorisation || !authorisation.paymentId) {
    return { ok: false, reason: "no settled hire, so nothing authorises this fill" };
  }
  if (!authorisation.client) {
    return { ok: false, reason: "the hire names no buyer wallet" };
  }
  if (!isPositive(authorisation.spendCapUsd)) {
    return { ok: false, reason: "the hire carries no spend cap" };
  }

  // Cap and rung are both USD, so they compare directly.
  if (!isPositive(orderSizeUsd)) {
    return { ok: false, reason: "orderSizeUsd must be positive" };
  }
  if (orderSizeUsd > authorisation.spendCapUsd) {
    return {
      ok: false,
      reason: `rung is ${orderSizeUsd} USD but the hire caps the session at ${authorisation.spendCapUsd} USD`,
    };
  }

  if (!isPositive(rungUsd)) {
    return { ok: false, reason: "rungUsd must be positive" };
  }

  const inRange = checkRange(rungUsd, request.rangeUsd);
  if (!inRange.ok) return { ok: false, reason: inRange.reason };


  try {
    const fill = buildRungFill({
      side,
      rungUsd,
      orderSizeUsd,
      feeBps,
      maxSlippageBps,
      baseToken,
      quoteToken,
    });
    return { ok: true, fill };
  } catch (e) {
    // buildRungFill validates its own inputs, so this lands here rather than at the router.
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Summed, since a per-rung cap alone lets ten rungs spend ten times the session. */
export function ladderBudgetUsd(rungs: number[], spendCapUsd: number): number {
  if (!isPositive(spendCapUsd)) return 0;
  const total = rungs.reduce((sum, size) => (isPositive(size) ? sum + size : sum), 0);
  return Math.min(total, spendCapUsd);
}

export function ladderFits(rungs: number[], spendCapUsd: number): boolean {
  if (!isPositive(spendCapUsd)) return false;
  const total = rungs.reduce((sum, size) => (isPositive(size) ? sum + size : sum), 0);
  return total > 0 && total <= spendCapUsd;
}
