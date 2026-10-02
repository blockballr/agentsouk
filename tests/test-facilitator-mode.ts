import { describe, expect, it, vi } from "vitest";
import { resolveFacilitatorMode, isFacilitatorMode } from "../src/lib/facilitator-mode";

// FACILITATOR_MODE set to an empty string reached the route as "" rather than the sandbox
// default, because `??` only catches null and undefined; these pin both halves of the fix.
// Outside production an unset mode is sandbox, which is the local default. In production it
// throws, because a sandbox settlement records a transaction hash that does not exist and
// skips the checks that bind a payout to the agent's registered wallet.
describe("resolveFacilitatorMode", () => {
  it("defaults to sandbox outside production when unset", () => {
    expect(resolveFacilitatorMode(undefined)).toBe("sandbox");
    expect(resolveFacilitatorMode(null)).toBe("sandbox");
  });

  it("treats an empty or whitespace value as sandbox outside production", () => {
    expect(resolveFacilitatorMode("")).toBe("sandbox");
    expect(resolveFacilitatorMode("   ")).toBe("sandbox");
    expect(resolveFacilitatorMode("\t\n")).toBe("sandbox");
  });

  it("refuses an unset mode in production rather than settling into sandbox", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => resolveFacilitatorMode(undefined)).toThrow(/FACILITATOR_MODE is unset/);
      expect(() => resolveFacilitatorMode(null)).toThrow(/FACILITATOR_MODE is unset/);
      expect(() => resolveFacilitatorMode("")).toThrow(/FACILITATOR_MODE is unset/);
      expect(() => resolveFacilitatorMode("   ")).toThrow(/FACILITATOR_MODE is unset/);
      expect(resolveFacilitatorMode("prod")).toBe("prod");
      expect(resolveFacilitatorMode("sandbox")).toBe("sandbox");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts the known modes", () => {
    expect(resolveFacilitatorMode("prod")).toBe("prod");
    expect(resolveFacilitatorMode("b402")).toBe("b402");
    expect(resolveFacilitatorMode("sandbox")).toBe("sandbox");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(resolveFacilitatorMode("PROD")).toBe("prod");
    expect(resolveFacilitatorMode(" prod ")).toBe("prod");
    expect(resolveFacilitatorMode("B402")).toBe("b402");
  });

  it("refuses a value it does not recognise instead of settling as sandbox", () => {
    expect(() => resolveFacilitatorMode("production")).toThrow(/FACILITATOR_MODE/);
    expect(() => resolveFacilitatorMode("prod ")).not.toThrow();
    expect(() => resolveFacilitatorMode("live")).toThrow(/sandbox/);
    expect(() => resolveFacilitatorMode("0")).toThrow(/FACILITATOR_MODE/);
    expect(() => resolveFacilitatorMode("true")).toThrow(/FACILITATOR_MODE/);
  });
});

describe("isFacilitatorMode", () => {
  it("narrows only the three supported values", () => {
    expect(isFacilitatorMode("prod")).toBe(true);
    expect(isFacilitatorMode("b402")).toBe(true);
    expect(isFacilitatorMode("sandbox")).toBe(true);
    expect(isFacilitatorMode("staging")).toBe(false);
  });
});
