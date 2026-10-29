import { describe, expect, it } from "vitest";
import {
  decideLendingDefense,
  lendingDefensePolicyFromEnv,
  type LendingDefensePolicy,
} from "../src/lib/lending-defense-policy";
import type { VenusPosition } from "../src/lib/venus";

function position(over: Partial<VenusPosition>): VenusPosition {
  return {
    account: "0x0000000000000000000000000000000000000001",
    marketsEntered: [],
    totalCollateralUsd: 1000,
    totalBorrowUsd: 500,
    liquidity: 0n,
    shortfall: 0n,
    healthFactor: 1.6,
    liquidatable: false,
    positions: [],
    ...over,
  };
}

const guard: LendingDefensePolicy = {
  profile: "guard",
  triggerHealthFactor: 1.6,
  targetHealthFactor: 1.9,
  maxSellBps: 2500,
  maxActionUsd: 100,
  maxSlippageBps: 500,
  cooldownMs: 3_600_000,
};

const exit: LendingDefensePolicy = { ...guard, profile: "exit", triggerHealthFactor: 1.25, targetHealthFactor: 1.25 };

describe("guard profile", () => {
  it("skips a position with no debt", () => {
    expect(decideLendingDefense(position({ healthFactor: null }), guard).action).toBe("skip");
  });

  it("refuses a position already liquidatable", () => {
    expect(decideLendingDefense(position({ liquidatable: true }), guard).action).toBe("refuse");
  });

  it("skips while above the line", () => {
    expect(decideLendingDefense(position({ healthFactor: 1.8 }), guard).action).toBe("skip");
  });

  it("repays from a stable balance before anything else", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.5 }), guard, { stableUsd: 60, collateralUsd: 60 });
    expect(d.action).toBe("repay");
  });

  it("posts collateral when there is no stable balance", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.5 }), guard, { stableUsd: 0, collateralUsd: 60 });
    expect(d.action).toBe("add-collateral");
  });

  it("never sells as a guard, even holding collateral only", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.5 }), guard, { stableUsd: 0, collateralUsd: 60 });
    expect(d.action).not.toBe("defend");
  });

  it("says plainly when it holds nothing", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.5 }), guard);
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/nothing it may act with/);
  });

  it("never exceeds the per-action cap", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.2, totalBorrowUsd: 900 }), guard, {
      stableUsd: 5000,
      collateralUsd: 0,
    });
    if (d.action !== "repay") throw new Error("expected a repay");
    expect(d.amountUsd).toBeLessThanOrEqual(guard.maxActionUsd);
  });

  it("stays quiet inside the cooldown", () => {
    const now = Date.parse("2026-10-29T12:00:00.000Z");
    const d = decideLendingDefense(
      position({ healthFactor: 1.5 }),
      guard,
      { stableUsd: 500, collateralUsd: 0 },
      now - 60_000,
      now,
    );
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/cooldown/);
  });

  it("acts again once the cooldown has passed", () => {
    const now = Date.parse("2026-10-29T12:00:00.000Z");
    const d = decideLendingDefense(
      position({ healthFactor: 1.5 }),
      guard,
      { stableUsd: 500, collateralUsd: 0 },
      now - guard.cooldownMs - 1,
      now,
    );
    expect(d.action).toBe("repay");
  });
});

describe("exit profile", () => {
  it("ignores a healthy position above its own line", () => {
    expect(decideLendingDefense(position({ healthFactor: 1.5 }), exit).action).toBe("skip");
  });

  it("sells collateral at its line, before liquidation", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.2 }), exit);
    expect(d.action).toBe("defend");
    if (d.action !== "defend") throw new Error("expected a defend");
    expect(d.amountToSell).toBeGreaterThan(0n);
  });

  it("caps the sale at the configured share of collateral", () => {
    const d = decideLendingDefense(position({ healthFactor: 1.05, totalBorrowUsd: 900 }), exit);
    if (d.action !== "defend") throw new Error("expected a defend");
    expect(Number(d.amountToSell) / 1e18).toBeLessThanOrEqual(100);
  });
});

describe("policy from env", () => {
  it("defaults to the guard profile", () => {
    expect(lendingDefensePolicyFromEnv({}).profile).toBe("guard");
  });

  it("reads the exit profile and its lines", () => {
    const p = lendingDefensePolicyFromEnv({
      LENDING_PROFILE: "exit",
      LENDING_DEFEND_AT: "1.3",
      LENDING_RESTORE_TO: "1.3",
    });
    expect(p.profile).toBe("exit");
    expect(p.triggerHealthFactor).toBe(1.3);
  });
});
