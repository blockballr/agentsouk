// an agent that is off the market takes no new hires: its terms are refused, and so is a
// payment sent to it without asking for terms. A check still goes through, because a passing
// check is how the agent comes back
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  // the settlement's refusals are for real settlements; the relay is stood in for below
  process.env.FACILITATOR_MODE = "prod";
});
const relay = vi.hoisted(() => ({ settleProd: vi.fn() }));

const detail = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("server-only", () => ({}));
// like the registry, it answers only for the chain and token it is asked about
vi.mock("../src/lib/scanner", () => ({
  fetchAgentDetail: async (chainId: number, tokenId: string) => (chainId === 97 && tokenId === "4100" ? detail.current : null),
}));
vi.mock("../src/lib/facilitator", () => ({ settleProd: relay.settleProd, settleSandbox: vi.fn() }));

import { NextRequest } from "next/server";
import { POST as requirementsRoute } from "../src/app/api/x402/requirements/route";
import { POST as settleRoute } from "../src/app/api/x402/settle/route";
import { setDelisted } from "../src/lib/delist-store";

const CARD = "https://agent.example/.well-known/agent-card.json";
const BUYER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const AGENT_WALLET = "0x06f757064043e57dbbccd6d95ee1113d9796c715";
// the marketplace's own relay wallet, which pays for its checks
const RELAY = "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4";

async function requirements(extra: Record<string, unknown> = {}) {
  const res = await requirementsRoute(
    new NextRequest("http://localhost/api/x402/requirements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: 97, tokenId: "4100", client: "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862", ...extra }),
    }),
  );
  return { res, body: await res.json() };
}

beforeEach(async () => {
  detail.current = {
    token_id: "4100",
    chain_id: 97,
    name: "Quiet Agent",
    owner_address: "0x06f757064043e57dbbccd6d95ee1113d9796c715",
    agent_wallet: "0x06f757064043e57dbbccd6d95ee1113d9796c715",
    a2a_endpoint: CARD,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ name: "Quiet Agent", skills: [{ name: "plan", description: "Plans a grid" }] }), { status: 200 })),
  );
  await setDelisted("4100", false);
  relay.settleProd.mockReset();
  relay.settleProd.mockImplementation(async (body: { paymentId?: string }) => ({
    success: true,
    paymentId: body.paymentId ?? "pay_relayed",
    details: { client: BUYER, payTo: AGENT_WALLET },
  }));
});

async function settle(paymentId: string, payer = BUYER, chainId: unknown = 97) {
  const res = await settleRoute(
    new NextRequest("http://localhost/api/x402/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentId,
        paymentPayload: { payload: { authorization: { from: payer } } },
        paymentRequirements: { payTo: AGENT_WALLET },
        agent: { chainId, tokenId: "4100", name: "Quiet Agent" },
      }),
    }),
  );
  return { res, body: await res.json() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hire terms for an agent that is off the market", () => {
  it("are refused before anyone signs", async () => {
    await setDelisted("4100", true, "auto-stale");
    const { res, body } = await requirements();
    expect(res.status).toBe(409);
    expect(body).toEqual({
      success: false,
      offMarket: true,
      error: "Quiet Agent is off the market, so it is not taking new hires.",
    });
  });

  it("are still given to a check, so the agent can earn its way back", async () => {
    await setDelisted("4100", true, "auto-stale");
    const { res, body } = await requirements({ purpose: "check" });
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("are given as usual once the agent is back on the market", async () => {
    await setDelisted("4100", true, "owner delist");
    await setDelisted("4100", false);
    const { res, body } = await requirements();
    expect(res.status).toBe(200);
    expect(body.data.paymentRequirements.payTo.toLowerCase()).toBe("0x06f757064043e57dbbccd6d95ee1113d9796c715");
  });
});

describe("a payment to an agent that is off the market", () => {
  it("is refused at settlement, for a caller that never asked for terms, and relays nothing", async () => {
    await setDelisted("4100", true, "auto-stale");
    const { res, body } = await settle("req_buyer");
    expect(res.status).toBe(409);
    expect(body).toEqual({
      success: false,
      refused: true,
      offMarket: true,
      error: "Quiet Agent is off the market, so it is not taking new hires.",
    });
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("still settles for the marketplace's own check, paid from its own wallet", async () => {
    await setDelisted("4100", true, "auto-stale");
    const { res } = await settle("verify_17a7fc3cbe5b", RELAY);
    expect(res.status).toBe(200);
    expect(relay.settleProd).toHaveBeenCalledTimes(1);
  });

  it("is not let through because the payment calls itself a check", async () => {
    await setDelisted("4100", true, "auto-stale");
    const { res, body } = await settle("verify_anything");
    expect(res.status).toBe(409);
    expect(body.offMarket).toBe(true);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("cannot be reached by naming another chain with a path for a token id", async () => {
    await setDelisted("4100", true, "auto-stale");
    expect((await requirements({ chainId: 56, tokenId: "../97/4100" })).res.status).toBe(400);
    const res = await settleRoute(
      new NextRequest("http://localhost/api/x402/settle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentId: "req_buyer",
          paymentPayload: { payload: { authorization: { from: BUYER } } },
          paymentRequirements: { payTo: AGENT_WALLET },
          agent: { chainId: 56, tokenId: "../97/4100", name: "Quiet Agent" },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("does not hold up the marketplace's own check when the registry cannot be read", async () => {
    detail.current = null;
    const { res } = await settle("verify_17a7fc3cbe5b", RELAY);
    expect(res.status).toBe(200);
    expect(relay.settleProd).toHaveBeenCalledTimes(1);
  });

  it("is refused when the chain is given as text, at the terms and at settlement", async () => {
    await setDelisted("4100", true, "auto-stale");
    expect((await requirements({ chainId: "97" })).res.status).toBe(409);
    const { res, body } = await settle("req_buyer", BUYER, "97");
    expect(res.status).toBe(409);
    expect(body.offMarket).toBe(true);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("settles as usual once the agent is back on the market", async () => {
    const { res, body } = await settle("req_buyer");
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
