import { describe, expect, it } from "vitest";
import {
  LIVENESS_GRADE,
  LIVENESS_METHOD,
  livenessEvidence,
  livenessGrade,
  livenessMethod,
} from "../src/lib/liveness";

// the oracle grades reachability and delivery apart, so a probe that only got
// an endpoint to answer must never post the delivery grade
describe("liveness grades", () => {
  it("grades an answering endpoint as reachable", () => {
    expect(livenessGrade({ ok: true, detail: "2 tools" })).toBe(LIVENESS_GRADE.reachable);
  });

  it("grades a refused endpoint as gated rather than dead", () => {
    expect(livenessGrade({ ok: false, detail: "a2a 401" })).toBe(LIVENESS_GRADE.gated);
    expect(livenessGrade({ ok: false, detail: "mcp 403" })).toBe(LIVENESS_GRADE.gated);
  });

  it("grades a listing with nothing callable as unreachable", () => {
    expect(livenessGrade({ ok: false, detail: "no callable endpoint" })).toBe(
      LIVENESS_GRADE.unreachable,
    );
  });

  it("grades an endpoint that answered wrongly as dead", () => {
    expect(livenessGrade({ ok: false, detail: "fetch failed" })).toBe(LIVENESS_GRADE.dead);
    expect(livenessGrade({ ok: false, detail: "mcp 500" })).toBe(LIVENESS_GRADE.dead);
  });
});

describe("liveness methods", () => {
  it("names what was actually called", () => {
    expect(livenessMethod("mcp")).toBe(LIVENESS_METHOD.mcp);
    expect(livenessMethod("a2a")).toBe(LIVENESS_METHOD.a2a);
    expect(livenessMethod(null)).toBe(LIVENESS_METHOD.card);
    expect(livenessMethod(undefined)).toBe(LIVENESS_METHOD.card);
  });
});

describe("evidence hash", () => {
  it("is a stable 32 byte digest of the reading, not the reading itself", () => {
    const hash = livenessEvidence("368655", "2 tools");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(livenessEvidence("368655", "2 tools")).toBe(hash);
    expect(livenessEvidence("368655", "3 tools")).not.toBe(hash);
  });
});
