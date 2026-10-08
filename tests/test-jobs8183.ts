import { afterEach, describe, expect, it, vi } from "vitest";
import { negotiateQuote, parseNegotiationQuote } from "@/lib/jobs8183";

// the ERC-8183 negotiate step, offline: the parser runs against the envelope
// shape the chain-97 grid agents answered with, and the dial path is stubbed
// at fetch so the private-address refusals and the happy path both read true.

const PAYMENT_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565";
const PROVIDER = "0x26dFfA1C42ff523Ee70F208a22424A2aEa4Df928";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "quoted",
    price: "1000000000000000000",
    currency: PAYMENT_TOKEN,
    valid_until: Math.floor(Date.now() / 1000) + 3600,
    negotiation_hash: `0x${"ab".repeat(32)}`,
    provider_sig: `0x${"cd".repeat(65)}`,
    provider_address: PROVIDER,
    agent_id: 2018,
    ...overrides,
  };
}

const fetched = vi.fn();
afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseNegotiationQuote", () => {
  it("accepts the envelope the grid agents answer with", () => {
    const result = parseNegotiationQuote(envelope(), 97, PROVIDER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote.price).toBe(1000000000000000000n);
      expect(result.quote.currency.toLowerCase()).toBe(PAYMENT_TOKEN.toLowerCase());
      expect(result.quote.providerAddress).toBe(PROVIDER);
      expect(result.quote.agentId).toBe("2018");
    }
  });

  it("refuses a reply that is not a negotiation envelope", () => {
    expect(parseNegotiationQuote({ status: "failed" }, 97, null).ok).toBe(false);
    expect(parseNegotiationQuote(null, 97, null).ok).toBe(false);
    expect(parseNegotiationQuote("quoted" as unknown, 97, null).ok).toBe(false);
  });

  it("refuses a refusal with its reason", () => {
    const result = parseNegotiationQuote(envelope({ accepted: false, unsigned_reason: "task too small" }), 97, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("task too small");
  });

  it("refuses a price the kernel would not escrow", () => {
    expect(parseNegotiationQuote(envelope({ price: "0" }), 97, null).ok).toBe(false);
    expect(parseNegotiationQuote(envelope({ price: "not-a-bigint" }), 97, null).ok).toBe(false);
    expect(parseNegotiationQuote(envelope({ price: `1${"0".repeat(24)}` }), 97, null).ok).toBe(false);
  });

  it("refuses a quote priced in a token the kernel does not escrow", () => {
    const result = parseNegotiationQuote(envelope({ currency: "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53" }), 97, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("the kernel does not escrow");
  });

  it("refuses a quote naming a different provider than the listing", () => {
    const result = parseNegotiationQuote(
      envelope({ provider_address: "0x0000000000000000000000000000000000000002" }),
      97,
      PROVIDER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not this listing's registry wallet");
  });

  it("refuses an expired quote", () => {
    const result = parseNegotiationQuote(envelope({ valid_until: 1 }), 97, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("expired");
  });

  it("refuses a quote with no proof attached", () => {
    expect(parseNegotiationQuote(envelope({ negotiation_hash: undefined }), 97, null).ok).toBe(false);
    expect(parseNegotiationQuote(envelope({ provider_sig: undefined }), 97, null).ok).toBe(false);
  });
});

describe("negotiateQuote", () => {
  it("refuses a private endpoint before any byte leaves", async () => {
    const result = await negotiateQuote(97, "http://localhost:8080/", "buy a grid plan", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/private/);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("answers the happy path when the endpoint quotes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: envelope() }), { status: 200 })),
    );
    const result = await negotiateQuote(97, `https://agent.example/a2a`, "buy a grid plan", PROVIDER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quote.price).toBe(1000000000000000000n);
  });
});
