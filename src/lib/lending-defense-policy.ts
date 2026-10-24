// Lending defense policy: monitors a Venus lending position and decides
// when to defend (sell collateral, repay debt) to prevent liquidation.
// Unlike the vault's Porter policy (which treats vault balances as a synthetic
// position), this policy reads a REAL lending position from Venus.

import type { VenusPosition } from "./venus";

export interface LendingDefensePolicy {
  // health factor below which defense triggers
  defendAt: number; // e.g., 1.5
  // health factor to restore to after defense
  restoreTo: number; // e.g., 2.0
  // max % of collateral to sell per defense (e.g., 25%)
  maxSellBps: number;
  // slippage tolerance in bps
  maxSlippageBps: number;
}

export function lendingDefensePolicyFromEnv(env: Record<string, string | undefined>): LendingDefensePolicy {
  return {
    defendAt: Number(env.LENDING_DEFEND_AT ?? "1.5"),
    restoreTo: Number(env.LENDING_RESTORE_TO ?? "2.0"),
    maxSellBps: Number(env.LENDING_MAX_SELL_BPS ?? "2500"),
    maxSlippageBps: Number(env.LENDING_MAX_SLIPPAGE_BPS ?? "500"),
  };
}

export type LendingDefenseDecision =
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string }
  | { action: "defend"; amountToSell: bigint; reason: string };

export function decideLendingDefense(
  position: VenusPosition,
  policy: LendingDefensePolicy,
): LendingDefenseDecision {
  // no debt = no risk
  if (position.healthFactor === null) {
    return { action: "skip", reason: "no debt, no liquidation risk" };
  }

  // already liquidatable - too late
  if (position.liquidatable) {
    return { action: "refuse", reason: "position is already liquidatable (shortfall > 0)" };
  }

  // healthy - no action needed
  if (position.healthFactor >= policy.defendAt) {
    return { action: "skip", reason: `health factor ${position.healthFactor.toFixed(2)} >= ${policy.defendAt}, no defense needed` };
  }

  // need to defend: sell collateral to repay debt
  // calculate how much collateral to sell to restore to restoreTo
  // target debt = collateral * threshold / restoreTo
  // debt to repay = current debt - target debt
  // collateral to sell = debt to repay / price (approx 1:1 for WBNB/USDT, simplified)
  const currentHF = position.healthFactor;
  const targetDebt = position.totalCollateralUsd * 0.8 / policy.restoreTo; // simplified: 80% collateral factor
  const debtToRepay = position.totalBorrowUsd - targetDebt;

  if (debtToRepay <= 0) {
    return { action: "skip", reason: "no debt to repay at target health factor" };
  }

  // cap at maxSellBps of collateral
  const maxSell = (position.totalCollateralUsd * policy.maxSellBps) / 10_000;
  const amountToSell = Math.min(debtToRepay, maxSell);

  if (amountToSell <= 0) {
    return { action: "skip", reason: "calculated sell amount is zero" };
  }

  return {
    action: "defend",
    amountToSell: BigInt(Math.floor(amountToSell * 1e18)),
    reason: `health factor ${currentHF.toFixed(2)} < ${policy.defendAt}, selling ${amountToSell.toFixed(2)} USD of collateral to restore to ${policy.restoreTo}`,
  };
}
