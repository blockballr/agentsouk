import { describe, expect, it } from "vitest";
import { resolveFacilitatorMode, isFacilitatorMode } from "../src/lib/facilitator-mode";

// FACILITATOR_MODE set to an empty string reached the route as "" rather than the sandbox
// default, because `??` only catches null and undefined; these pin both halves of the fix.
describe("resolveFacilitatorMode", () => {
  it("defaults to sandbox when unset", () => {
    expect(resolveFacilitatorMode(undefined)).toBe("sandbox");
    expect(resolveFacilitatorMode(null)).toBe("sandbox");
  });

  it("treats an empty or whitespace value as sandbox", () => {
    expect(resolveFacilitatorMode("")).toBe("sandbox");
    expect(resolveFacilitatorMode("   ")).toBe("sandbox");
    expect(resolveFacilitatorMode("\t\n")).toBe("sandbox");
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
