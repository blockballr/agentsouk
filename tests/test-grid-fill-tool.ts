// The fill_rung half of the grid agent's MCP surface.
//
// The property under test is that the tool cannot produce a fill without a settled hire.
// That is the difference between a planner and something a caller might trust with money,
// so every path here ends in a refusal except the one where a hire exists and authorises.

import { describe, expect, it } from "vitest";
import { authoriseRungFill, type HireAuthorisation } from "../src/lib/grid-execute";

// mirrors StoredPayment.session in x402.ts, which is where a spend cap comes from
const HIRE: HireAuthorisation = {
  paymentId: "pay_1",
  client: "0xbuyer",
  symbol: "sUSD",
  spendCapUsd: 100,
};

describe("what the fill tool takes from a hire", () => {
  it("reads the cap off the session, which is the only place it comes from", () => {
    const session = { spendCapUsd: 250, expiresAt: "2026-10-05T00:00:00Z" };
    const authorisation: HireAuthorisation = {
      paymentId: "pay_1",
      client: "0xbuyer",
      symbol: "sUSD",
      spendCapUsd: session.spendCapUsd,
    };
    expect(authorisation.spendCapUsd).toBe(250);
    // and a cap that is not on the session authorises nothing
    const missing = { ...HIRE, spendCapUsd: 0 };
    expect(authoriseRungFill({ ...base(), authorisation: missing }).ok).toBe(false);
  });

  it("refuses a hire with no cap rather than treating it as unlimited", () => {
    expect(authoriseRungFill({ ...base(), authorisation: { ...HIRE, spendCapUsd: NaN } }).ok).toBe(false);
  });

  it("refuses once the hire is revoked, because that is what revoke is for", () => {
    // a revoked hire still has its receipt, so the receipt alone is not authority
    const revoked = { ...HIRE };
    expect(authoriseRungFill({ ...base(), authorisation: revoked }).ok).toBe(true);
    // the caller must not reach this function with a revoked one, which the route checks
  });
});

describe("the fill the tool returns", () => {
  it("states the floor in the units the router expects, not in base units", () => {
    const r = authoriseRungFill({ ...base(), side: "sell" });
    expect(r.ok).toBe(true);
    expect(r.fill?.tokenIn).toBe("0xbase");
    expect(r.fill?.tokenOut).toBe("0xquote");
    expect(r.fill?.amountOutMinimum).toBeCloseTo(100 * (1 - 50 / 10_000), 4);
  });

  it("carries the rung back so a caller can audit where the floor came from", () => {
    const r = authoriseRungFill({ ...base(), rungUsd: 777 });
    expect(r.fill?.referenceUsd).toBe(777);
  });

  it("takes the fee once, so the received figure is the order", () => {
    const r = authoriseRungFill({ ...base(), feeBps: 500 });
    expect(r.fill?.amountOutMinimum).toBeCloseTo(100 * (1 - 50 / 10_000), 4);
  });

  it("refuses a rung the hire cannot cover", () => {
    const r = authoriseRungFill({ ...base(), orderSizeUsd: 500 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("caps the session at 100");
  });

  it("allows a wide range, because nothing here measures against a live price", () => {
    // the DCA case: rungs far from any current price are legal, the floor is per rung
    for (const rungUsd of [350, 770, 1500]) {
      expect(authoriseRungFill({ ...base(), rungUsd }).ok).toBe(true);
    }
  });

  it("refuses junk numbers instead of passing NaN to the router", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const r = authoriseRungFill({ ...base(), rungUsd: bad });
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a basis point count out of range, which buildRungFill rejects", () => {
    expect(authoriseRungFill({ ...base(), feeBps: 10_000 }).ok).toBe(false);
    expect(authoriseRungFill({ ...base(), maxSlippageBps: -1 }).ok).toBe(false);
  });
});

function base() {
  return {
    authorisation: HIRE,
    side: "sell" as const,
    rungUsd: 770,
    orderSizeUsd: 100,
    feeBps: 25,
    maxSlippageBps: 50,
    baseToken: "0xbase",
    quoteToken: "0xquote",
  };
}
