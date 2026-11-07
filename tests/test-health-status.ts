// A buyer should be able to tell a working guard from a silent one. The status
// is a pure read of the run log, so these pin the three states it must separate.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { watchStatus, WATCH_STALE_AFTER_MS } from "../src/lib/health-status";
import type { CronRun } from "../src/lib/history-store";

const NOW = Date.parse("2026-11-07T12:00:00.000Z");

function run(minutesAgo: number, ok: boolean, note: string | null = null): CronRun {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return { name: "health-watch", startedAt: at, finishedAt: at, ok, note };
}

describe("the watch status", () => {
  it("reads a recent good run as healthy", () => {
    const status = watchStatus([run(4, true)], NOW);
    expect(status.stale).toBe(false);
    expect(status.degraded).toBe(false);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.ok).toBe(true);
    expect(status.lastRunAt).toBe(new Date(NOW - 4 * 60_000).toISOString());
  });

  it("reads no run at all as stale and degraded", () => {
    const status = watchStatus([], NOW);
    expect(status.lastRunAt).toBeNull();
    expect(status.ageMs).toBeNull();
    expect(status.stale).toBe(true);
    expect(status.degraded).toBe(true);
  });

  it("does not call one failed run a degrade", () => {
    const status = watchStatus([run(3, false, "answered 500")], NOW);
    expect(status.ok).toBe(false);
    expect(status.consecutiveFailures).toBe(1);
    expect(status.degraded).toBe(false);
    expect(status.note).toBe("answered 500");
  });

  it("degrades after two failures in a row", () => {
    const status = watchStatus([run(3, false), run(13, false), run(23, true)], NOW);
    expect(status.consecutiveFailures).toBe(2);
    expect(status.degraded).toBe(true);
  });

  it("clears the failure count on the next good run", () => {
    const status = watchStatus([run(3, true), run(13, false), run(23, false)], NOW);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.degraded).toBe(false);
  });

  it("reads silence past the budget as stale even when the last run passed", () => {
    const minutes = Math.round(WATCH_STALE_AFTER_MS / 60_000) + 1;
    const status = watchStatus([run(minutes, true)], NOW);
    expect(status.stale).toBe(true);
    expect(status.degraded).toBe(true);
  });

  it("orders runs by start time rather than by array position", () => {
    const status = watchStatus([run(30, false), run(2, true)], NOW);
    expect(status.ok).toBe(true);
    expect(status.consecutiveFailures).toBe(0);
  });
});
