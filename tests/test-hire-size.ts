// A hire's size has two numbers and one gate. The contract refuses anything
// under its own floor; the agent's number is the size at which the strategy is
// worth the gas, so a smaller deposit still opens and the page warns instead of
// blocking. These are the two pure checks behind that copy.
import { describe, expect, it } from "vitest";
import { belowRecommendedSize, underVaultFloor } from "../apps/web/src/lib/vault";

describe("hire size", () => {
  it("blocks only under the contract floor", () => {
    expect(underVaultFloor("0.5", 1)).toBe(true);
    expect(underVaultFloor("1", 1)).toBe(false);
    expect(underVaultFloor("2", 1)).toBe(false);
  });

  it("treats a missing or zero floor as no floor", () => {
    expect(underVaultFloor("0.5", null)).toBe(false);
    expect(underVaultFloor("0.5", 0)).toBe(false);
  });

  it("does not treat an empty or unparseable field as a deposit", () => {
    expect(underVaultFloor("", 1)).toBe(false);
    expect(underVaultFloor("abc", 1)).toBe(false);
    expect(belowRecommendedSize("", 25)).toBe(false);
  });

  it("warns below the agent's recommended size without blocking", () => {
    expect(belowRecommendedSize("2", 25)).toBe(true);
    expect(belowRecommendedSize("25", 25)).toBe(false);
    expect(belowRecommendedSize("40", 25)).toBe(false);
  });

  it("says nothing when the agent names no recommendation", () => {
    expect(belowRecommendedSize("2", null)).toBe(false);
    expect(belowRecommendedSize("2", 0)).toBe(false);
  });

  it("a deposit above the floor but under the recommendation is the test case", () => {
    expect(underVaultFloor("2", 1)).toBe(false);
    expect(belowRecommendedSize("2", 25)).toBe(true);
  });
});
