// The defence picks the position closest to liquidation and sizes the repay from
// the gap to the target, never past the buyer's per-call cap.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { coverageFrom, pickWorst, repayAmount, type RankedPosition } from "../src/lib/health-operator";

function position(index: number, healthFactor: number): RankedPosition {
  return {
    index,
    account: `0x${String(index).padStart(40, "0")}` as `0x${string}`,
    vTokenDebt: "0x" + "11".repeat(20),
    healthFactor,
    debt: 0n,
    debtUsd: 0,
  };
}

describe("portfolio defence", () => {
  it("defends the lowest health factor", () => {
    const picked = pickWorst([position(0, 2.4), position(1, 1.08), position(2, 1.9)]);
    expect(picked?.index).toBe(1);
  });

  it("ignores a position whose health factor could not be read", () => {
    const picked = pickWorst([position(0, Number.NaN), position(1, 3.2)]);
    expect(picked?.index).toBe(1);
  });

  it("returns nothing for an empty portfolio", () => {
    expect(pickWorst([])).toBeNull();
  });

  it("does not repay a position already above the target", () => {
    expect(repayAmount(1.6, 1_000n, 500n, 1.5)).toBe(0n);
    expect(repayAmount(1.5, 1_000n, 500n, 1.5)).toBe(0n);
  });

  it("sizes the repay from the gap and caps it", () => {
    // at 1.0 against a 1.5 target, a third of the debt retires the gap
    expect(repayAmount(1.0, 900n, 1_000n, 1.5)).toBe(300n);
    // the per-call cap wins when the gap is larger than it
    expect(repayAmount(0.2, 9_000n, 500n, 1.5)).toBe(500n);
  });

  it("reads coverage from liquidity, shortfall and debt", () => {
    expect(coverageFrom(500n, 0n, 1_000n)).toBe(1.5);
    expect(coverageFrom(0n, 200n, 1_000n)).toBe(0.8);
    expect(coverageFrom(0n, 0n, 1_000n)).toBe(1);
    expect(coverageFrom(0n, 0n, 0n)).toBe(Number.POSITIVE_INFINITY);
  });

  it("has nothing to do without debt or budget", () => {
    expect(repayAmount(0.5, 0n, 500n)).toBe(0n);
    expect(repayAmount(0.5, 1_000n, 0n)).toBe(0n);
  });
});
