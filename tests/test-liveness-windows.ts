// A probe costs nothing, so every listing is read on one flat cadence and nobody
// gets a long window that could hide a death. The exception runs the other way:
// a listing that is failing is re-probed on a short backoff, so a repaired agent
// is back on the market within minutes. The backoff grows while it stays broken
// and the first healthy row clears the clock.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));

import {
  dueForLivenessCheck,
  isFailing,
  livenessWindowMs,
  RECOVERY_BACKOFF_MS,
} from "../src/app/api/cron/liveness/route";
import { statusForFailedDelivery } from "../src/lib/verifications";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const failing = (downForMs: number) => ({
  status: "dead",
  checkedAt: ago(downForMs),
  failing_since: ago(downForMs),
});
const healthy = (sinceMs: number) => ({ status: "delivered", checkedAt: ago(sinceMs) });

describe("what counts as failing", () => {
  it("reads the failure clock or a failing status as failing", () => {
    expect(isFailing(failing(0))).toBe(true);
    expect(isFailing({ status: "unreachable" })).toBe(true);
    expect(isFailing({ status: "dead" })).toBe(true);
  });

  it("reads an answered or gated listing as healthy", () => {
    expect(isFailing(healthy(0))).toBe(false);
    expect(isFailing({ status: "gated" })).toBe(false);
    expect(isFailing(undefined)).toBe(false);
  });
});

describe("the cadence", () => {
  it("gives every healthy listing the same flat window, however good its evidence", () => {
    // the week-long window that hid deaths is gone: proven and merely answered
    // now cost exactly the same to re-read
    const proven = { status: "delivered", quality: { grade: "good", model: "deterministic" } };
    expect(livenessWindowMs(healthy(0), NOW)).toBe(livenessWindowMs(proven, NOW));
    expect(livenessWindowMs(healthy(0), NOW)).toBe(6 * HOUR);
  });

  it("re-probes a just-broken listing within minutes, not hours", () => {
    const entry = failing(10 * 60_000);
    expect(livenessWindowMs(entry, NOW)).toBe(RECOVERY_BACKOFF_MS[0]);
    expect(dueForLivenessCheck({ ...entry, checkedAt: ago(10 * 60_000) }, NOW)).toBe(false);
    expect(dueForLivenessCheck({ ...entry, checkedAt: ago(20 * 60_000) }, NOW)).toBe(true);
  });

  it("backs off while it stays broken so one dead agent cannot eat the run", () => {
    expect(livenessWindowMs(failing(20 * 60_000), NOW)).toBe(RECOVERY_BACKOFF_MS[1]);
    expect(livenessWindowMs(failing(5 * HOUR), NOW)).toBe(RECOVERY_BACKOFF_MS[2]);
    // and it never backs off past the flat cadence the healthy shelf runs on
    expect(livenessWindowMs(failing(30 * 24 * HOUR), NOW)).toBeLessThanOrEqual(6 * HOUR);
  });

  it("puts a repaired agent back on the flat cadence the moment it is healthy", () => {
    const repaired = healthy(2 * 60_000);
    expect(isFailing(repaired)).toBe(false);
    expect(livenessWindowMs(repaired, NOW)).toBe(6 * HOUR);
    expect(dueForLivenessCheck(repaired, NOW)).toBe(false);
  });

  it("always picks up anything it has no usable reading for", () => {
    expect(dueForLivenessCheck(undefined, NOW)).toBe(true);
    expect(dueForLivenessCheck({ checkedAt: "not a date" }, NOW)).toBe(true);
  });

  it("opens the backoff minutes first, so recovery is measured in minutes", () => {
    expect(RECOVERY_BACKOFF_MS[0]).toBeLessThanOrEqual(15 * 60_000);
    for (let i = 1; i < RECOVERY_BACKOFF_MS.length; i += 1) {
      expect(RECOVERY_BACKOFF_MS[i]).toBeGreaterThan(RECOVERY_BACKOFF_MS[i - 1]);
    }
  });
});

describe("a delivery that fails", () => {
  it("lands in the same rows a probe writes", () => {
    expect(statusForFailedDelivery(false)).toBe("dead");
    expect(statusForFailedDelivery(true)).toBe("gated");
  });

  it("is read as failing, so the fast re-probes begin", () => {
    expect(isFailing({ status: statusForFailedDelivery(false) })).toBe(true);
    // a gate is the seller's own answer, not a failure to answer
    expect(isFailing({ status: statusForFailedDelivery(true) })).toBe(false);
  });
});