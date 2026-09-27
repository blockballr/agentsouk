// The nightly sweep must record an endpoint the marketplace cannot reach as
// unreachable, and say why, rather than calling it dead or delivered. These pin
// that decision with no network call.
import { describe, expect, it } from "vitest";
import { endpointFailureReason, unreachableEndpointVerdict } from "../src/lib/verifications";

const LOOPBACK_A2A =
  '"http://localhost:8080/" is a private address that the marketplace cannot reach. ' +
  "the agent's card names it as the messaging url, so the owner needs to publish a public one.";

const LOOPBACK_MCP =
  '"http://localhost:8080/" is a private address that the marketplace cannot reach. ' +
  "the agent's registry record points there, so the owner needs to publish a public endpoint.";

const GATED =
  "This agent gates direct calls behind its own x402 payment; the session receipt covers the marketplace hire but not the agent's per-call fee.";

describe("endpoint failure detection", () => {
  it("recognizes the loopback messaging url the card on token 2173 declares", () => {
    expect(endpointFailureReason(LOOPBACK_A2A)).toBe(LOOPBACK_A2A);
    expect(endpointFailureReason(LOOPBACK_MCP)).toBe(LOOPBACK_MCP);
  });

  it("recognizes private, malformed and non-http addresses however delivery names them", () => {
    for (const reason of [
      '"http://10.0.0.5/rpc" is a private address that the marketplace cannot reach',
      '"http://127.0.0.1:8545/" is a private address that the marketplace cannot reach',
      '"not a url" is not a valid url',
      '"ftp://example.com/x" is not an http url',
    ]) {
      expect(endpointFailureReason(`${reason}. the agent's registry record points there.`)).toBeTruthy();
    }
  });

  it("does not claim an endpoint problem for a gated x402 agent or a generic failure", () => {
    for (const error of [
      GATED,
      "message/send failed: fetch failed",
      "initialize failed: request failed: fetch failed",
      "HTTP 500",
      "",
    ]) {
      expect(endpointFailureReason(error)).toBeNull();
    }
  });

  it("does not mistake a quoted non-url in another agent error for the endpoint", () => {
    expect(endpointFailureReason('"Insufficient balance" is why the tool failed')).toBeNull();
    expect(endpointFailureReason('tools/call failed: "Insufficient balance"')).toBeNull();
  });

  it("reads the reason out of an Error as well as a string", () => {
    expect(endpointFailureReason(new Error(LOOPBACK_A2A))).toBe(LOOPBACK_A2A);
  });
});

describe("unreachable endpoint verdict", () => {
  it("records the failure as unreachable, with the reason, never delivered", () => {
    const verdict = unreachableEndpointVerdict(LOOPBACK_A2A);
    expect(verdict).not.toBeNull();
    expect(verdict?.status).toBe("unreachable");
    expect(verdict?.detail).toMatch(/cannot reach/);
    expect(verdict?.detail).toContain("localhost:8080");
  });

  it("returns null for a failure that is not about the endpoint, so its own status stands", () => {
    expect(unreachableEndpointVerdict(GATED)).toBeNull();
  });
});
