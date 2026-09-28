// A warm serverless instance reuses module state, so a sweep clock captured at
// module scope reads stale on the next invocation and the budget check exits
// before the first candidate, reporting verified:0 after minutes of nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { sweepBudget } from "../src/app/api/cron/verify/route";

const OVER_BUDGET_MS = 5 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sweep budget clock", () => {
  it("is not out of time when freshly started", () => {
    const { outOfTime } = sweepBudget();
    expect(outOfTime()).toBe(false);
  });

  it("expires once its own budget elapses", () => {
    const { outOfTime } = sweepBudget();
    vi.advanceTimersByTime(OVER_BUDGET_MS);
    expect(outOfTime()).toBe(true);
  });

  it("a later invocation starts a fresh budget instead of inheriting a stale one", () => {
    const first = sweepBudget();
    vi.advanceTimersByTime(OVER_BUDGET_MS);
    expect(first.outOfTime()).toBe(true);
    // this is the regression: the old module-level clock stayed expired forever,
    // so every later sweep on a warm instance verified zero candidates
    const second = sweepBudget();
    expect(second.outOfTime()).toBe(false);
    expect(second.startedAt).toBeGreaterThan(first.startedAt);
  });
});
