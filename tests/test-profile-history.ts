// what the profile's strips are drawn from: hires counted by day, and a check record turned
// into marks that read left to right in time
import { describe, expect, it } from "vitest";
import { checkMarks, checkSummary, countByDay } from "../apps/web/src/lib/history";

const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("counting by day", () => {
  it("covers the last days oldest first, with a zero for a day nothing happened", () => {
    const days = countByDay(["2026-10-05T01:00:00Z", "2026-10-05T23:59:59Z", "2026-10-03T10:00:00Z"], 4, NOW);
    expect(days).toEqual([
      { day: "2026-10-02", count: 0 },
      { day: "2026-10-03", count: 1 },
      { day: "2026-10-04", count: 0 },
      { day: "2026-10-05", count: 2 },
    ]);
  });

  it("leaves out what is older than the window or cannot be read as a date", () => {
    const days = countByDay(["2026-09-01T00:00:00Z", "not a date", ""], 3, NOW);
    expect(days.map((d) => d.count)).toEqual([0, 0, 0]);
  });
});

describe("a check record as marks", () => {
  const checks = [
    { status: "dead", checkedAt: "2026-10-05T11:00:00.000Z", responseMs: null },
    { status: "gated", checkedAt: "2026-10-05T06:00:00.000Z", responseMs: 300 },
    { status: "delivered", checkedAt: "2026-10-05T01:00:00.000Z", responseMs: 800 },
  ];

  it("runs oldest first and tells answered, gated and missed apart", () => {
    expect(checkMarks(checks).map((m) => m.state)).toEqual(["answered", "gated", "missed"]);
    expect(checkMarks(checks)[0].title).toBe("2026-10-05 01:00 UTC: delivered");
  });

  it("says in words what the strip shows", () => {
    expect(checkSummary(checks)).toBe("1 of the last 3 checks answered");
    expect(checkSummary([])).toBe("No checks recorded yet");
  });
});
