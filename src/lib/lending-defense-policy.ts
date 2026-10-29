import type { VenusPosition } from "./venus";

export type Profile = "guard" | "exit";

export interface LendingDefensePolicy {
  profile: Profile;
  triggerHealthFactor: number;
  targetHealthFactor: number;
  maxSellBps: number;
  maxActionUsd: number;
  maxSlippageBps: number;
  cooldownMs: number;
}

export interface Holdings {
  stableUsd: number;
  collateralUsd: number;
}

export type LendingDefenseDecision =
  | { action: "skip"; reason: string }
  | { action: "refuse"; reason: string }
  | { action: "defend"; amountToSell: bigint; reason: string }
  | { action: "repay"; amountUsd: number; reason: string }
  | { action: "add-collateral"; amountUsd: number; reason: string };

export function lendingDefensePolicyFromEnv(env: Record<string, string | undefined>): LendingDefensePolicy {
  return {
    profile: env.LENDING_PROFILE === "exit" ? "exit" : "guard",
    triggerHealthFactor: Number(env.LENDING_DEFEND_AT ?? "1.6"),
    targetHealthFactor: Number(env.LENDING_RESTORE_TO ?? "1.9"),
    maxSellBps: Number(env.LENDING_MAX_SELL_BPS ?? "2500"),
    maxActionUsd: Number(env.LENDING_MAX_ACTION_USD ?? "100"),
    maxSlippageBps: Number(env.LENDING_MAX_SLIPPAGE_BPS ?? "500"),
    cooldownMs: Number(env.LENDING_COOLDOWN_MS ?? "3600000"),
  };
}

function debtToRepayFor(position: VenusPosition, target: number): number {
  if (position.healthFactor === null || position.healthFactor <= 0) return 0;
  const trimmed = position.totalBorrowUsd * (1 - position.healthFactor / target);
  return Math.max(0, trimmed);
}

export function decideLendingDefense(
  position: VenusPosition,
  policy: LendingDefensePolicy,
  holdings: Holdings = { stableUsd: 0, collateralUsd: 0 },
  lastActionAt: number | null = null,
  now: number = Date.now(),
): LendingDefenseDecision {
  if (position.healthFactor === null) {
    return { action: "skip", reason: "no debt, no liquidation risk" };
  }

  if (position.liquidatable) {
    return { action: "refuse", reason: "position is already liquidatable (shortfall > 0)" };
  }

  if (position.healthFactor >= policy.triggerHealthFactor) {
    return {
      action: "skip",
      reason: `health factor ${position.healthFactor.toFixed(2)} >= ${policy.triggerHealthFactor}, no action needed`,
    };
  }

  if (lastActionAt !== null && now - lastActionAt < policy.cooldownMs) {
    return { action: "skip", reason: "inside the cooldown since the last action" };
  }

  const need = debtToRepayFor(position, policy.targetHealthFactor);

  if (policy.profile === "guard") {
    if (holdings.stableUsd > 0 && need > 0) {
      const amountUsd = Math.min(need, holdings.stableUsd, policy.maxActionUsd);
      if (amountUsd > 0) {
        return {
          action: "repay",
          amountUsd,
          reason: `health factor ${position.healthFactor.toFixed(2)} < ${policy.triggerHealthFactor}, repaying from the balance held`,
        };
      }
    }
    if (holdings.collateralUsd > 0 && need > 0) {
      const amountUsd = Math.min(need, holdings.collateralUsd, policy.maxActionUsd);
      if (amountUsd > 0) {
        return {
          action: "add-collateral",
          amountUsd,
          reason: `health factor ${position.healthFactor.toFixed(2)} < ${policy.triggerHealthFactor}, posting collateral held`,
        };
      }
    }
    return { action: "skip", reason: "below the guard line but the agent holds nothing it may act with" };
  }

  if (need <= 0) {
    return { action: "skip", reason: "no debt to repay at the target health factor" };
  }

  const maxSell = (position.totalCollateralUsd * policy.maxSellBps) / 10_000;
  const amountToSell = Math.min(need, maxSell, policy.maxActionUsd);
  if (amountToSell <= 0) {
    return { action: "skip", reason: "calculated sell amount is zero" };
  }

  return {
    action: "defend",
    amountToSell: BigInt(Math.floor(amountToSell * 1e18)),
    reason: `health factor ${position.healthFactor.toFixed(2)} < ${policy.triggerHealthFactor}, selling ${amountToSell.toFixed(2)} USD of collateral`,
  };
}
