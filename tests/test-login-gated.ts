// An agent behind its own login (OAuth, as BNB Agent Studio deploys them) answers
// 401 or 403. It is alive, so it is recorded as gated rather than dead, and a
// gated verdict never starts the clock that delists a listing after seven days.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GATED_RE, loginGatedOutcome } from "../src/lib/delivery";
import { countsAsFailing } from "../src/lib/verifications-store";

describe("login-gated endpoints", () => {
  it("reads 401 and 403 as gated for both protocols, in words the verifier recognises", () => {
    for (const protocol of ["a2a", "mcp"] as const) {
      for (const status of [401, 403]) {
        const outcome = loginGatedOutcome(protocol, status);
        expect(outcome).toMatchObject({ protocol, ok: false, gated: true });
        expect(GATED_RE.test(outcome?.error ?? "")).toBe(true);
      }
    }
  });

  it("leaves every other status to the normal path", () => {
    for (const status of [200, 400, 404, 405, 500]) {
      expect(loginGatedOutcome("a2a", status)).toBeNull();
    }
  });

  it("still recognises the x402 gate", () => {
    expect(GATED_RE.test("This agent gates direct calls behind its own x402 payment; the session receipt covers the marketplace hire")).toBe(true);
  });

  it("runs the delist clock only for an agent that gave no answer", () => {
    expect(countsAsFailing("delivered")).toBe(false);
    expect(countsAsFailing("gated")).toBe(false);
    expect(countsAsFailing("dead")).toBe(true);
    expect(countsAsFailing("unreachable")).toBe(true);
  });
});
