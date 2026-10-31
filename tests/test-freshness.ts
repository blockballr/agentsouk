import { describe, expect, it } from "vitest";
import { readFreshness } from "../src/lib/freshness";

const now = Date.parse("2026-10-31T12:00:00.000Z");

describe("freshness", () => {
  it("calls a recent read fresh", () => {
    const r = readFreshness("2026-10-31T11:59:30.000Z", now);
    expect(r.state).toBe("fresh");
    expect(r.ageMs).toBe(30_000);
  });

  it("calls an old read stale", () => {
    expect(readFreshness("2026-10-31T11:58:00.000Z", now).state).toBe("stale");
  });

  it("calls a read past the bound dead", () => {
    expect(readFreshness("2026-10-31T11:50:00.000Z", now).state).toBe("dead");
  });

  it("treats a missing read as dead with no age", () => {
    expect(readFreshness(null, now)).toEqual({ state: "dead", ageMs: null });
  });
});
