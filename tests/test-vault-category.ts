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
    expect(categoryRail(null).category).toBe("not-declared");
    expect(categoryRail("nonsense").deposit).toBe("pair");
  });

  it("does not treat a health factor as a swap", () => {
    expect(categoryRail("health-factor").deposit).not.toBe("pair");
  });
});

describe("category form", () => {
  it("gives every category its own title, not the swap one", () => {
    const titles = ["yield", "grid-trading", "rebalancing", "health-factor", null].map(
      (category) => categoryRail(category).ui.title,
    );
    expect(new Set(titles).size).toBe(titles.length);
    expect(categoryRail("grid-trading").ui.title).toContain("grids");
    expect(categoryRail("rebalancing").ui.title).toContain("target weight");
  });

  it("gives a yield agent its own heading and no liquidity controls", () => {
    const rail = categoryRail("yield");
    expect(rail.label).toBe("Yield");
    expect(rail.ui.heading).toBe("Open a yield hire");
    expect(rail.ui.depositLabel).toBe("Deposit one asset");
    expect(rail.ui.showsSlippage).toBe(false);
    expect(rail.ui.showsPoolChoice).toBe(false);
    expect(rail.ui.unsupported).toBeNull();
  });

  it("keeps the pair controls for grid and rebalance", () => {
    for (const category of ["grid-trading", "rebalancing"]) {
      const rail = categoryRail(category);
      expect(rail.ui.showsSlippage).toBe(true);
      expect(rail.ui.showsPoolChoice).toBe(true);
    }
  });

  it("explains why a health factor has no form", () => {
    const rail = categoryRail("health-factor");
    expect(rail.supported).toBe(false);
    expect(rail.ui.unsupported?.title).toContain("not on the vault rail");
    expect(rail.ui.unsupported?.body).toContain("cannot borrow");
  });

  it("says what the open does in the category's words", () => {
    expect(categoryRail("yield").ui.actionLine).toContain("supply and withdraw");
    expect(categoryRail("grid-trading").ui.actionLine).toContain("fee tier");
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
