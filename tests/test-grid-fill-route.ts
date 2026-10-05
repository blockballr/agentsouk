// The route handler, exercised.
//
// tests/test-grid-fill-tool.ts covers the arithmetic and the refusals in authoriseRungFill.
// This covers the part that could not fail in that file: the handler reading a receipt,
// checking whether the session was revoked, and deciding whether to answer at all. Every
// refusal here is a refusal the caller sees, and none of it is a transport error, because
// a caller that reads "no cap" knows to fix the hire while one reading a connection fault
// would just retry.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const receipts = vi.hoisted(() => ({
  getPaymentDurable: vi.fn(async (): Promise<unknown> => undefined),
  sessionRevoked: vi.fn(async (): Promise<boolean> => false),
}));
vi.mock("@/lib/receipts-store", () => receipts);

// imported once here rather than inside each call: the dynamic import inside a test is
// paid for by whichever test runs first, which timed the first one out
import { POST } from "@/app/api/reference/grid/mcp/route";

const BUYER = "0xb0b";

function receipt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paymentId: "pay_1",
    createdAt: "2026-10-04T00:00:00Z",
    txHash: "0xabc",
    mode: "sandbox",
    agent: { chainId: 97, tokenId: "1", name: "Souk Grid Planner" },
    client: BUYER,
    payTo: "0xagent",
    amount: "100",
    symbol: "sUSD",
    activated: true,
    session: { spendCapUsd: 100, expiresAt: "2026-10-05T00:00:00Z" },
    ...over,
  };
}

async function fill(args: Record<string, unknown>) {
  const res = await POST(
    new NextRequest("http://localhost/api/reference/grid/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "fill_rung", arguments: args },
      }),
    }),
  );
  const body = (await res.json()) as {
    result?: { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
    error?: { message: string };
  };
  return body;
}

const RUNG = {
  side: "sell",
  rungUsd: 770,
  orderSizeUsd: 100,
  feeBps: 25,
  maxSlippageBps: 50,
  baseToken: "0xbase",
  quoteToken: "0xquote",
};

beforeEach(() => {
  receipts.getPaymentDurable.mockReset().mockResolvedValue(undefined);
  receipts.sessionRevoked.mockReset().mockResolvedValue(false);
});

describe("fill_rung refuses without a settled hire", () => {
  it("refuses when no paymentId is sent", async () => {
    const body = await fill({ ...RUNG });
    expect(body.result?.structuredContent).toMatchObject({ refused: true });
    expect(body.result?.content[0].text.toLowerCase()).toContain("no settled hire");
  });

  it("refuses when the receipt is not found, rather than treating the miss as unlimited", async () => {
    receipts.getPaymentDurable.mockResolvedValue(undefined);
    const body = await fill({ ...RUNG, paymentId: "pay_missing" });
    expect(body.result?.structuredContent).toMatchObject({ refused: true });
  });

  it("never calls the store for an absent paymentId", async () => {
    await fill({ ...RUNG });
    expect(receipts.getPaymentDurable).not.toHaveBeenCalled();
  });

  it("is a refusal and not an error, so a caller reads the reason", async () => {
    const body = await fill({ ...RUNG });
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
  });
});

describe("fill_rung refuses a revoked hire", () => {
  it("refuses when the session was revoked, which is what revoke is for", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    receipts.sessionRevoked.mockResolvedValue(true);
    const body = await fill({ ...RUNG, paymentId: "pay_1" });
    expect(body.result?.structuredContent).toMatchObject({
      refused: true,
      reason: expect.stringContaining("revoked"),
    });
  });
});

describe("fill_rung refuses a side it cannot trade", () => {
  it("refuses a side that is neither buy nor sell", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1", side: "hodl" });
    expect(body.result?.structuredContent).toMatchObject({
      refused: true,
      reason: expect.stringContaining("buy or sell"),
    });
  });
});

describe("fill_rung answers when the hire authorises it", () => {
  it("returns the figures and names the authority", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1" });
    const artifact = body.result?.structuredContent as Record<string, unknown>;
    expect(artifact.authorised).toBe(true);
    expect(artifact.amountIn).toBeGreaterThan(0);
    // the floor is the order less the slippage allowed, in quote units
    expect(artifact.amountOutMinimum as number).toBeCloseTo(100 * (1 - 50 / 10_000), 4);
    expect(artifact.authorisedBy).toMatchObject({ paymentId: "pay_1", client: BUYER });
    expect(artifact.spendCapUsd).toBe(100);
  });

  it("says plainly that it placed nothing", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1" });
    expect(body.result?.content[0].text).toContain("placed nothing");
  });

  it("refuses a rung larger than the cap the hire granted", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1", orderSizeUsd: 500 });
    expect(body.result?.structuredContent).toMatchObject({
      refused: true,
      reason: expect.stringContaining("caps the session at 100"),
    });
  });

  it("refuses when the receipt carries no cap, rather than spending without a limit", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt({ session: undefined }));
    const body = await fill({ ...RUNG, paymentId: "pay_1" });
    expect(body.result?.structuredContent).toMatchObject({ refused: true });
  });

  it("refuses a rung priced at nonsense instead of passing NaN to the router", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1", rungUsd: "seven hundred" });
    expect(body.result?.structuredContent).toMatchObject({ refused: true });
  });

  it("refuses a rung outside the range the caller declared", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({
      ...RUNG,
      paymentId: "pay_1",
      rungUsd: 1600,
      rangeLowerUsd: 500,
      rangeUpperUsd: 1500,
    });
    expect(body.result?.structuredContent).toMatchObject({
      refused: true,
      reason: expect.stringContaining("outside"),
    });
  });

  it("admits a rung inside the declared range", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({
      ...RUNG,
      paymentId: "pay_1",
      rungUsd: 770,
      rangeLowerUsd: 500,
      rangeUpperUsd: 1500,
    });
    expect(body.result?.structuredContent).toMatchObject({ authorised: true });
  });

  it("ignores a half sent range rather than refusing on one bound", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt());
    const body = await fill({ ...RUNG, paymentId: "pay_1", rangeLowerUsd: 500 });
    expect(body.result?.structuredContent).toMatchObject({ authorised: true });
  });

  it("takes the cap from the session rather than from anything the caller sends", async () => {
    receipts.getPaymentDurable.mockResolvedValue(receipt({ session: { spendCapUsd: 10, expiresAt: "x" } }));
    // a caller claiming a bigger cap in the arguments changes nothing
    const body = await fill({ ...RUNG, paymentId: "pay_1", spendCapUsd: 100000 });
    expect(body.result?.structuredContent).toMatchObject({
      refused: true,
      reason: expect.stringContaining("caps the session at 10"),
    });
  });
});

describe("the planner still works beside it", () => {
  it("answers a plan_grid call, so the second tool did not break the first", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/reference/grid/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "plan_grid",
            arguments: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100 },
          },
        }),
      }),
    );
    const body = (await res.json()) as { result?: { content: { text: string }[] }; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.result?.content[0].text.length).toBeGreaterThan(20);
  });
});
