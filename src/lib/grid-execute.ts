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
