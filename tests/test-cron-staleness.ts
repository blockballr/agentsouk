import { describe, expect, it } from "vitest";
import { stalenessBreaches, alertLine, type StaleRoute } from "../src/lib/cron-staleness";
import type { CronRun } from "../src/lib/history-store";

const HOUR = 3_600_000;
const now = Date.parse("2026-10-06T20:00:00Z");

function run(name: string, startedHoursAgo: number, ok = true): CronRun {
  return {
    name,
    startedAt: new Date(now - startedHoursAgo * HOUR).toISOString(),
    finishedAt: new Date(now - startedHoursAgo * HOUR).toISOString(),
    ok,
    note: null,
  };
}

describe("stalenessBreaches", () => {
  it("holds a name of a fresh run under every budget", () => {
    const runs = [run("refresh", 1), run("verify", 5), run("maintenance", 4), run("pancake", 2)];
    expect(stalenessBreaches(runs, now)).toEqual([]);
  });

  it("reports a route whose runner has stopped", () => {
    const runs = [run("refresh", 1), run("verify", 40)];
    const breaches = stalenessBreaches(runs, now);
    // a name with no run at all breaches too, so pancake and maintenance join
    expect(breaches.map((b) => b.name)).toEqual(["verify", "pancake", "maintenance"]);
    expect(breaches[0].age).toBeGreaterThan(26 * HOUR);
  });

  it("treats no recorded run as the worst case", () => {
    const breaches = stalenessBreaches([], now);
    expect(breaches).toHaveLength(4);
    const refresh = breaches.find((b) => b.name === "refresh")!;
    expect(refresh.lastRunAt).toBeNull();
    expect(refresh.ok).toBe(false);
  });

  it("reads only the most recent run per name, whatever the order", () => {
    const runs = [run("refresh", 30), run("refresh", 1)];
    // one route fresh at 1h, another grey with no runs at all
    const breaches = stalenessBreaches(runs, now);
    expect(breaches.find((b) => b.name === "refresh")).toBeUndefined();
    expect(breaches.map((b) => b.name)).toEqual(["verify", "pancake", "maintenance"]);
  });

  it("reports a failed run as failed, and names the stale recent details", () => {
    const stale: StaleRoute = {
      name: "verify",
      label: "verifier sweep",
      lastRunAt: new Date(now - 40 * HOUR).toISOString(),
      ok: false,
      note: "upstream 500",
      age: 40 * HOUR,
      allowedGapMs: 26 * HOUR,
    };
    expect(alertLine(stale)).toContain("verify (verifier sweep)");
    expect(alertLine(stale)).toContain("40h");
    expect(alertLine(stale)).toContain("failed");
  });
});
