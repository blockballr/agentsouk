import { describe, expect, it } from "vitest";
import { ANSWERING_WITHIN_MS, answeringPick, declaredPrice } from "../src/lib/quest-pick-health";

const now = Date.parse("2026-10-27T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

describe("answeringPick", () => {
  it("keeps a listing nobody has checked, because unknown is not a failure", () => {
    expect(answeringPick(undefined, now)).toBe(true);
  });

  it("keeps a fresh online check", () => {
    expect(answeringPick({ status: "online", checkedAt: hoursAgo(4) }, now)).toBe(true);
  });

  it("drops a listing whose last check failed, however recent", () => {
    for (const status of ["dead", "unreachable", "unresponsive", "restricted", "gated"]) {
      expect(answeringPick({ status, checkedAt: hoursAgo(1) }, now)).toBe(false);
    }
  });

  it("drops an online check old enough to stop describing the listing", () => {
    const justInside = ANSWERING_WITHIN_MS / 3600_000 - 1;
    const justOutside = ANSWERING_WITHIN_MS / 3600_000 + 1;
    expect(answeringPick({ status: "online", checkedAt: hoursAgo(justInside) }, now)).toBe(true);
    expect(answeringPick({ status: "online", checkedAt: hoursAgo(justOutside) }, now)).toBe(false);
  });

  it("treats an unparsable timestamp as no answer rather than as fresh", () => {
    expect(answeringPick({ status: "online", checkedAt: "not a date" }, now)).toBe(false);
  });
});

describe("declaredPrice", () => {
  it("carries the seller's own words", () => {
    expect(declaredPrice([{ id: "a" }, { price: " 0.10 $U " }])).toBe("0.10 $U");
  });

  it("returns nothing when no skill declares a price", () => {
    expect(declaredPrice([{ id: "a" }])).toBeNull();
    expect(declaredPrice(undefined)).toBeNull();
    expect(declaredPrice([{ price: 42 }])).toBeNull();
    expect(declaredPrice([{ price: "   " }])).toBeNull();
  });
});
