// Availability is one verdict over the verification row, the quotable flag, the
// shelf admission and the delist. These pin the combinations the app used to
// re-derive from separate fields.
import { describe, expect, it } from "vitest";
import { deriveAvailability } from "../packages/core/src/machines/availability";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function input(over: Partial<Parameters<typeof deriveAvailability>[0]> = {}) {
  return deriveAvailability({
    status: "online",
    quotable: true,
    failingSince: null,
    delisted: false,
    admitted: true,
    canExecute: true,
    category: "yield",
    now: NOW,
    ...over,
  });
}

describe("the availability machine", () => {
  it("reads a live admitted listing as shelf-ready and hireable", () => {
    const view = input();
    expect(view.phase).toBe("live");
    expect(view.shelf).toBe(true);
    expect(view.hireable).toBe(true);
    expect(view.reason).toMatch(/hireable/);
  });

  it("treats delivered as the same verdict as online", () => {
    expect(input({ status: "delivered" }).phase).toBe("live");
  });

  it("keeps a gated agent on the shelf but stops hiring at the gate", () => {
    const view = input({ status: "gated" });
    expect(view.phase).toBe("gated");
    expect(view.shelf).toBe(true);
    expect(view.hireable).toBe(false);
    expect(view.reason).toMatch(/access gate/);
  });

  it("reads a card-declared gate the same way as a gated verdict", () => {
    const view = input({ status: "online", accessGated: true });
    expect(view.phase).toBe("gated");
    expect(view.hireable).toBe(false);
  });

  it("counts the failure clock and stops hireability", () => {
    const view = input({ status: "unreachable", failingSince: new Date(NOW - 3 * DAY).toISOString() });
    expect(view.phase).toBe("failing");
    expect(view.failingDays).toBe(3);
    expect(view.shelf).toBe(false);
    expect(view.hireable).toBe(false);
    expect(view.reason).toMatch(/3 days/);
  });

  it("ignores a stale failure clock on a live verdict", () => {
    const view = input({ status: "online", failingSince: new Date(NOW - 3 * DAY).toISOString() });
    expect(view.phase).toBe("live");
    expect(view.failingDays).toBeNull();
  });

  it("lets a delist override a live verdict", () => {
    const view = input({ delisted: true });
    expect(view.phase).toBe("delisted");
    expect(view.shelf).toBe(false);
    expect(view.hireable).toBe(false);
  });

  it("keeps a live listing off the shelf when it has no admission", () => {
    const view = input({ admitted: false });
    expect(view.phase).toBe("live");
    expect(view.shelf).toBe(false);
    expect(view.hireable).toBe(false);
  });

  it("keeps an unquotable or uncallable listing off the shelf", () => {
    expect(input({ quotable: false }).hireable).toBe(false);
    expect(input({ canExecute: false }).hireable).toBe(false);
    expect(input({ category: "general" }).hireable).toBe(false);
    expect(input({ category: null }).hireable).toBe(false);
  });

  it("reads a missing verdict as not checked", () => {
    expect(input({ status: null }).phase).toBe("not-checked");
    expect(input({ status: "not_checked" }).phase).toBe("not-checked");
  });

  it("does not pretend an unknown verdict is live", () => {
    const view = input({ status: "something-new" });
    expect(view.phase).toBe("unknown");
    expect(view.hireable).toBe(false);
    expect(view.reason).toMatch(/not in a known vocabulary/);
  });

  it("names the remaining no-answer verdicts", () => {
    for (const status of ["dead", "unresponsive", "restricted"] as const) {
      const view = input({ status });
      expect(view.phase).toBe(status);
      expect(view.hireable).toBe(false);
    }
  });

  it("does not invent a day count for an unparsable clock", () => {
    const view = input({ status: "dead", failingSince: "not-a-date" });
    expect(view.phase).toBe("failing");
    expect(view.failingDays).toBeNull();
  });
});
