// A free deterministic check is evidence the work happens, so it earns its own
// word. Only a paid test hire may say Delivered, only a probe may say Online, and
// the line under the dot has to name which check ran.
import { describe, expect, it } from "vitest";

import { isProbeCheck, verdictFor } from "../apps/web/src/lib/verdict";

const MAINNET = 56;
const TESTNET = 97;

const deterministic = (grade: "good" | "partial" | "poor") => ({
  grade,
  reason: "checked against the expected value",
  model: "deterministic",
});

describe("verdict vocabulary", () => {
  it("reads a correct deterministic check as proven work, not as a probe", () => {
    const verdict = verdictFor(MAINNET, {
      status: "delivered",
      responseMs: 340,
      quality: deterministic("good"),
    });
    expect(verdict.label).toBe("Proven");
    expect(verdict.tone).toBe("good");
    expect(verdict.explain).toMatch(/can check/);
    expect(verdict.explain).toMatch(/No hire was paid/);
  });

  it("falls back to reachability when the checked answer did not hold up", () => {
    for (const grade of ["partial", "poor"] as const) {
      const verdict = verdictFor(MAINNET, {
        status: "delivered",
        responseMs: 400,
        quality: deterministic(grade),
      });
      expect(verdict.label).toBe("Online");
      expect(verdict.explain).toMatch(/did not hold up/);
    }
  });

  it("keeps Delivered for a paid test hire", () => {
    const verdict = verdictFor(MAINNET, { status: "delivered", responseMs: 1200 });
    expect(verdict.label).toBe("Delivered");
    expect(verdict.explain).toMatch(/paid test hire/);
  });

  it("reads a testnet probe with nothing scored as Online, never Delivered", () => {
    const verdict = verdictFor(TESTNET, { status: "delivered", responseMs: 340 });
    expect(verdict.label).toBe("Online");
    expect(verdict.explain).not.toMatch(/paid test hire/);
  });

  it("leaves the four states a probe can produce alone", () => {
    expect(verdictFor(MAINNET, null).label).toBe("Not checked yet");
    expect(verdictFor(MAINNET, { status: "gated" }).label).toBe("Restricted");
    expect(verdictFor(MAINNET, { status: "unreachable" }).label).toBe("Unreachable");
    expect(verdictFor(MAINNET, { status: "dead" }).label).toBe("Unresponsive");
  });

  it("still names a deterministic check as a probe check for the pages that ask", () => {
    expect(isProbeCheck(MAINNET, deterministic("good"))).toBe(true);
    expect(isProbeCheck(TESTNET, undefined)).toBe(true);
    expect(isProbeCheck(MAINNET, undefined)).toBe(false);
  });
});