import { describe, expect, it } from "vitest";
import {
  assessAuthority,
  BOND_BACKING,
  describeAuthority,
  earnedTier,
  MIN_BOND_USD,
  type AuthorityFacts,
} from "../src/lib/authority";
import { normaliseDeclaration } from "../src/lib/authority-declaration";

const NOW = Date.parse("2026-11-03T12:00:00Z");

function facts(over: Partial<AuthorityFacts> = {}): AuthorityFacts {
  return {
    hires: 0,
    completed: 0,
    distinctBuyers: 0,
    successRate: null,
    firstHireAt: null,
    verified: true,
    bondUsd: null,
    priceUsd: 0.02,
    now: NOW,
    ...over,
  };
}

describe("earned tier", () => {
  it("starts every agent at new", () => {
    expect(earnedTier(facts())).toBe("new");
  });

  it("counts two distinct buyers and two completions as known", () => {
    expect(earnedTier(facts({ distinctBuyers: 2, completed: 2, successRate: 0.9, hires: 2 }))).toBe("known");
  });

  it("will not promote a buyer repeat to known", () => {
    expect(earnedTier(facts({ distinctBuyers: 1, completed: 9, successRate: 1, hires: 9 }))).toBe("new");
  });

  it("requires age as well as volume for proven", () => {
    const young = facts({
      distinctBuyers: 6,
      completed: 12,
      successRate: 0.95,
      firstHireAt: "2026-11-02T12:00:00Z",
    });
    expect(earnedTier(young)).toBe("known");
    const old = { ...young, firstHireAt: "2026-10-01T12:00:00Z" };
    expect(earnedTier(old)).toBe("proven");
  });
});

describe("grant", () => {
  it("caps a new agent at one price and puts the loss on escrow", () => {
    const grant = assessAuthority(facts());
    expect(grant.model).toBe("job-scoped");
    expect(grant.spendCapUsd).toBe(0.02);
    expect(grant.lossBearer).toBe("escrow");
    expect(grant.expiresInHours).toBe(24);
  });

  it("widens the cap for a known agent", () => {
    const grant = assessAuthority(facts({ distinctBuyers: 3, completed: 4, successRate: 1, hires: 4 }));
    expect(grant.model).toBe("earned");
    expect(grant.spendCapUsd).toBe(0.03);
    expect(grant.expiresInHours).toBe(72);
  });

  it("ignores a bond under the floor", () => {
    const grant = assessAuthority(facts({ bondUsd: MIN_BOND_USD - 1 }));
    expect(grant.model).toBe("job-scoped");
    expect(grant.bondBackedUsd).toBe(0);
  });

  it("backs an underwritten grant with the owner bond", () => {
    const grant = assessAuthority(facts({ bondUsd: 50 }));
    expect(grant.model).toBe("underwritten");
    expect(grant.lossBearer).toBe("owner-bond");
    expect(grant.bondBackedUsd).toBe(50);
    expect(grant.spendCapUsd).toBe(0.02);
  });

  it("never lets the cap exceed what the bond covers", () => {
    const grant = assessAuthority(
      facts({
        distinctBuyers: 8,
        completed: 20,
        successRate: 1,
        firstHireAt: "2026-09-01T12:00:00Z",
        bondUsd: 50,
        priceUsd: 4,
      }),
    );
    expect(grant.model).toBe("underwritten");
    expect(grant.spendCapUsd).toBe(10);
    expect(grant.spendCapUsd * BOND_BACKING).toBeLessThanOrEqual(grant.bondBackedUsd);
  });

  it("refuses a bond that cannot cover one hire", () => {
    const grant = assessAuthority(facts({ bondUsd: MIN_BOND_USD, priceUsd: 2 }));
    expect(grant.model).toBe("job-scoped");
  });

  it("never returns a negative or NaN cap", () => {
    const grant = assessAuthority(facts({ priceUsd: -3, bondUsd: 40 }));
    expect(grant.spendCapUsd).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(grant.spendCapUsd)).toBe(true);
  });
});

describe("summary", () => {
  it("names the model, the cap and the party holding the loss", () => {
    const grant = assessAuthority(facts({ bondUsd: 40 }));
    expect(describeAuthority(grant)).toContain("underwritten");
    expect(describeAuthority(grant)).toContain("owner bond");
  });
});

describe("declaration", () => {
  it("accepts a job-scoped lease", () => {
    const checked = normaliseDeclaration({ model: "job-scoped" });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.capUsd).toBeNull();
  });

  it("refuses an unknown model", () => {
    const checked = normaliseDeclaration({ model: "unlimited" });
    expect(checked.ok).toBe(false);
  });

  it("refuses an underwritten declaration with no bond", () => {
    const checked = normaliseDeclaration({ model: "underwritten" });
    expect(checked.ok).toBe(false);
  });

  it("accepts an underwritten declaration with a bond and a wallet", () => {
    const checked = normaliseDeclaration({
      model: "underwritten",
      bondUsd: 25,
      bondWallet: "0x84fedaBd1b83443aD86796C15619494878B64180",
    });
    expect(checked.ok).toBe(true);
  });

  it("refuses a bond wallet that is not an address", () => {
    const checked = normaliseDeclaration({ model: "underwritten", bondUsd: 5, bondWallet: "nope" });
    expect(checked.ok).toBe(false);
  });

  it("dedupes and lowercases the scope", () => {
    const checked = normaliseDeclaration({ model: "leash", scope: ["Yield", "yield", "grid-trading"] });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.scope).toEqual(["yield", "grid-trading"]);
  });
});

describe("declaration as a ceiling", () => {
  const proven = facts({
    distinctBuyers: 8,
    completed: 20,
    successRate: 1,
    firstHireAt: "2026-09-01T12:00:00Z",
    priceUsd: 0.1,
    bondUsd: 50,
  });

  it("narrows an earned cap to the declared number", () => {
    const grant = assessAuthority(proven, { model: "underwritten", capUsd: 0.15, expiresHours: null, bondUsd: 50 });
    expect(grant.spendCapUsd).toBe(0.15);
  });

  it("holds a declared lease to one hire even for a proven agent", () => {
    const grant = assessAuthority(proven, { model: "job-scoped", capUsd: null, expiresHours: null, bondUsd: null });
    expect(grant.model).toBe("job-scoped");
    expect(grant.spendCapUsd).toBe(0.1);
  });

  it("shortens the declared life and never lengthens it", () => {
    const short = assessAuthority(proven, { model: "underwritten", capUsd: null, expiresHours: 6, bondUsd: 50 });
    expect(short.expiresInHours).toBe(6);
    const long = assessAuthority(proven, { model: "underwritten", capUsd: null, expiresHours: 900, bondUsd: 50 });
    expect(long.expiresInHours).toBe(168);
  });

  it("cannot widen a new agent past one price", () => {
    const grant = assessAuthority(facts(), { model: "underwritten", capUsd: 100, expiresHours: null, bondUsd: null });
    expect(grant.spendCapUsd).toBe(0.02);
  });
});
