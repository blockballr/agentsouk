// The defence is one relationship over a mandate, a prepaid plan and the
// watcher. These pin the illegal combinations that used to be re-derived in
// three places.
import { describe, expect, it } from "vitest";
import { deriveDefence } from "../packages/core/src/machines/defence";

const NOW = 1_800_000_000;
const DAY = 86_400;
const ZERO = "0x0000000000000000000000000000000000000000";

const healthy = { stale: false, consecutiveFailures: 0, ok: true };

function mandate(expiry: number, active = true) {
  return { active, expiry, positions: 1 };
}

function plan(expiry: number, agent = "0x1111111111111111111111111111111111111111") {
  return { agent, expiry };
}

describe("the defence machine", () => {
  it("reads no mandate as unprotected", () => {
    const view = deriveDefence({ now: NOW, mandate: null, plan: null, feeBalance: 0n, watch: null, gasLow: null });
    expect(view.phase).toBe("unprotected");
    expect(view.mandate).toBe("none");
    expect(view.allowedActions).toContain("set-mandate");
    expect(view.allowedActions).toContain("fund");
    expect(view.nextEvent.kind).toBe("none");
  });

  it("reads an active mandate with a healthy watch as protected", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 7 * DAY),
      plan: plan(NOW + 7 * DAY),
      feeBalance: 50_000_000_000_000_000n,
      watch: healthy,
      gasLow: false,
    });
    expect(view.phase).toBe("protected");
    expect(view.mandate).toBe("active");
    expect(view.plan).toBe("active");
    expect(view.watch).toBe("healthy");
    expect(view.gas).toBe("ok");
    expect(view.allowedActions).toEqual(["revoke", "cancel", "withdraw"]);
    expect(view.nextEvent).toEqual({ kind: "mandate-expiry", at: NOW + 7 * DAY });
  });

  it("degrades when the watcher goes quiet", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 7 * DAY),
      plan: plan(NOW + 7 * DAY),
      feeBalance: 0n,
      watch: { stale: true, consecutiveFailures: 0, ok: true },
      gasLow: false,
    });
    expect(view.phase).toBe("degraded");
    expect(view.watch).toBe("stale");
    expect(view.reason).toMatch(/quiet/);
  });

  it("degrades and offers a top up when gas is low", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 7 * DAY),
      plan: plan(NOW + 7 * DAY),
      feeBalance: 0n,
      watch: healthy,
      gasLow: true,
    });
    expect(view.phase).toBe("degraded");
    expect(view.gas).toBe("low");
    expect(view.allowedActions).toContain("top-up");
    expect(view.reason).toMatch(/network fees/);
  });

  it("reads a passed expiry as lapsed, not active", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW - 1),
      plan: plan(NOW - 1),
      feeBalance: 0n,
      watch: healthy,
      gasLow: false,
    });
    expect(view.phase).toBe("lapsed");
    expect(view.mandate).toBe("expired");
    expect(view.plan).toBe("expired");
    expect(view.allowedActions).toContain("set-mandate");
    expect(view.allowedActions).toContain("revoke");
    expect(view.allowedActions).toContain("fund");
  });

  it("reads the last day of a mandate as expiring", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 2 * 3600),
      plan: plan(NOW + 7 * DAY),
      feeBalance: 0n,
      watch: healthy,
      gasLow: false,
    });
    expect(view.phase).toBe("expiring");
    expect(view.reason).toMatch(/2 hours/);
    expect(view.allowedActions).toContain("set-mandate");
  });

  it("lets an orphan plan be cancelled and its balance withdrawn", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: null,
      plan: plan(NOW + 7 * DAY),
      feeBalance: 10n,
      watch: healthy,
      gasLow: false,
    });
    expect(view.phase).toBe("unprotected");
    expect(view.plan).toBe("active");
    expect(view.allowedActions).toEqual(["set-mandate", "cancel", "withdraw"]);
    expect(view.nextEvent).toEqual({ kind: "plan-expiry", at: NOW + 7 * DAY });
  });

  it("treats a zero plan agent as no plan", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 7 * DAY),
      plan: plan(NOW + 7 * DAY, ZERO),
      feeBalance: 0n,
      watch: healthy,
      gasLow: false,
    });
    expect(view.plan).toBe("none");
    expect(view.allowedActions).toContain("fund");
  });

  it("keeps an unknown watch from claiming health", () => {
    const view = deriveDefence({
      now: NOW,
      mandate: mandate(NOW + 7 * DAY),
      plan: null,
      feeBalance: 0n,
      watch: null,
      gasLow: null,
    });
    expect(view.watch).toBe("unknown");
    expect(view.gas).toBe("unknown");
    expect(view.phase).toBe("protected");
  });
});
