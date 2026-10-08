import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters } from "viem";
import { negotiateQuote, notifySeller, kernelJob, parseNegotiationQuote } from "@/lib/jobs8183";

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

describe("notifySeller", () => {
  const PAYLOAD = { job_id: 4242, commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" };

  it("hands the seller the notify payload and reads the ack", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "notified", job_id: 4242 } }), { status: 200 }),
      ),
    );
    const result = await notifySeller(97, "https://agent.example/a2a", PAYLOAD);
    expect(result.ok).toBe(true);
    expect(result.reply).toContain("notified");
  });

  it("records the usual no-ack reply as evidence, ok false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { status: "quoted" } }), { status: 200 }),
      ),
    );
    const result = await notifySeller(97, "https://agent.example/a2a", PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.reply).toContain("quoted");
  });

  it("refuses a private endpoint before dialing", async () => {
    const result = await notifySeller(97, "http://localhost:8080/", PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.reply).toMatch(/private/);
  });
});

describe("kernelJob", () => {
  it("decodes a live getJob answer from the chain", async () => {
    const TUPLE = [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "string" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint8" },
      { type: "address" },
    ] as const;
    const fixture = encodeAbiParameters(
      TUPLE,
      [4242n, "0x0000000000000000000000000000000000000000", "0x26dFfA1C42ff523Ee70F208a22424A2aEa4Df928", "0x0000000000000000000000000000000000000001", "", 1000000000000000000n, 1791500000n, 1, "0x0000000000000000000000000000000000000002"],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: fixture }), { status: 200 })),
    );
    const job = await kernelJob(97, 4242);
    expect(job?.status).toBe(1);
    expect(job?.client).toBe("0x0000000000000000000000000000000000000000");
    expect(job?.provider.toLowerCase()).toBe("0x26dffa1c42ff523ee70f208a22424a2aea4df928");
    expect(job?.budget).toBe(1000000000000000000n);
    expect(Number(job?.expiredAt)).toBe(1791500000);
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
