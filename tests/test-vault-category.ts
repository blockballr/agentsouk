import { describe, expect, it } from "vitest";
import { categoryRail, policyMatchesCategory } from "../apps/web/src/lib/vault-category";

describe("category rail", () => {
  it("opens a yield agent as a single asset into a venue", () => {
    const rail = categoryRail("yield");
    expect(rail.policy).toBe("buffer");
    expect(rail.deposit).toBe("single");
    expect(rail.actions).toContain("supply");
  });

  it("opens a grid agent as a pair", () => {
    const rail = categoryRail("grid-trading");
    expect(rail.policy).toBe("grid");
    expect(rail.deposit).toBe("pair");
  });

  it("says a health factor cannot be defended on this rail", () => {
    const rail = categoryRail("health-factor");
    expect(rail.supported).toBe(false);
    expect(rail.actions).toEqual([]);
    expect(rail.note).toContain("borrow");
  });

  it("falls back to a swap for an unknown or missing category", () => {
    expect(categoryRail(null).category).toBe("general");
    expect(categoryRail("nonsense").deposit).toBe("pair");
  });

  it("does not treat a health factor as a swap", () => {
    expect(categoryRail("health-factor").deposit).not.toBe("pair");
  });
});

describe("policy fit", () => {
  it("accepts a buffer policy on a yield listing", () => {
    expect(policyMatchesCategory("buffer", "yield")).toBe(true);
  });

  it("refuses a buffer policy on a grid listing", () => {
    expect(policyMatchesCategory("buffer", "grid-trading")).toBe(false);
  });

  it("accepts grid and band on the pair categories", () => {
    expect(policyMatchesCategory("grid", "grid-trading")).toBe(true);
    expect(policyMatchesCategory("band", "rebalancing")).toBe(true);
  });

  it("treats an untagged hire as acceptable", () => {
    expect(policyMatchesCategory(null, "yield")).toBe(true);
  });
});
