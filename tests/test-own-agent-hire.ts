// a wallet cannot hire the agent it owns or the agent that pays it: the terms step refuses a
// caller that names itself, the settlement refuses the payment whoever asked for terms, and
// the passport counts neither. A check still gets through, since that is how an owner tests.
// The settlement also holds a payment to the agent it names, so a transfer to any wallet
// cannot be passed off as a hire of someone else's agent
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  // the binding is for real settlements; the relay itself is stood in for below
  process.env.FACILITATOR_MODE = "prod";
  return { detail: null as Record<string, unknown> | null, payments: [] as unknown[], agents: [] as unknown[] };
});
const relay = vi.hoisted(() => ({ settleProd: vi.fn() }));

vi.mock("server-only", () => ({}));
// like the registry, it answers only for the chain and token it is asked about
vi.mock("../src/lib/scanner", () => ({
  fetchAgentDetail: async (chainId: number, tokenId: string) => (chainId === 97 && tokenId === "4200" ? store.detail : null),
  queryAgents: async () => ({ items: store.agents, total: store.agents.length }),
}));
vi.mock("../src/lib/facilitator", () => ({ settleProd: relay.settleProd, settleSandbox: vi.fn() }));
vi.mock("../src/lib/receipts-store", () => ({
  listPaymentsByClient: async () => store.payments,
  receiptsMode: () => "memory",
}));

import { NextRequest } from "next/server";
import { GET as progressRoute } from "../src/app/api/quest/progress/route";
import { POST as requirementsRoute } from "../src/app/api/x402/requirements/route";
import { POST as settleRoute } from "../src/app/api/x402/settle/route";

const OWNER = "0x06f757064043e57dbbccd6d95ee1113d9796c715";
const AGENT_WALLET = "0x1111111111111111111111111111111111111111";
const BUYER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const ELSEWHERE = "0x2222222222222222222222222222222222222222";
// the marketplace's own relay wallet, which pays for its checks
const RELAY = "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4";
const CARD = "https://agent.example/.well-known/agent-card.json";

function post(route: (req: NextRequest) => Promise<Response>, path: string, body: unknown) {
  return route(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  store.detail = {
    token_id: "4200",
    chain_id: 97,
    name: "Own Agent",
    owner_address: OWNER,
    agent_wallet: AGENT_WALLET,
    a2a_endpoint: CARD,
  };
  store.payments = [];
  relay.settleProd.mockReset();
  relay.settleProd.mockImplementation(async (body: { paymentId?: string }) => ({
    success: true,
    paymentId: body.paymentId ?? "pay_relayed",
    details: { client: BUYER, payTo: AGENT_WALLET },
  }));
  store.agents = [{ chain_id: 97, token_id: "4200", name: "Own Agent", category: "yield", owner_address: OWNER }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ name: "Own Agent", skills: [{ name: "plan", description: "Plans a grid" }] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hire terms", () => {
  it("are refused to the agent's owner and to its receiving wallet, in any letter case", async () => {
    for (const client of [OWNER, OWNER.toUpperCase().replace("0X", "0x"), AGENT_WALLET]) {
      const res = await post(requirementsRoute, "/api/x402/requirements", { chainId: 97, tokenId: "4200", client });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.ownAgent).toBe(true);
      expect(body.error).toBe("Own Agent is your own agent, so this wallet cannot hire it. Use Re-check now on your profile to test it.");
    }
  });

  it("are not given for a token id that is not a number", async () => {
    const res = await post(requirementsRoute, "/api/x402/requirements", { chainId: 56, tokenId: "../97/4200", client: BUYER });
    expect(res.status).toBe(400);
  });

  it("are still given when the caller's address is not text", async () => {
    const res = await post(requirementsRoute, "/api/x402/requirements", { chainId: 97, tokenId: "4200", client: 123 });
    expect(res.status).toBe(200);
  });

  it("are given to anyone else, and to a check even from the owner", async () => {
    const buyer = await post(requirementsRoute, "/api/x402/requirements", { chainId: 97, tokenId: "4200", client: BUYER });
    expect(buyer.status).toBe(200);
    const check = await post(requirementsRoute, "/api/x402/requirements", { chainId: 97, tokenId: "4200", client: OWNER, purpose: "check" });
    expect(check.status).toBe(200);
  });
});

describe("settlement", () => {
  const settle = (payer: string, payTo: string, extra: Record<string, unknown> = {}) =>
    post(settleRoute, "/api/x402/settle", {
      paymentPayload: { payload: { authorization: { from: payer } } },
      paymentRequirements: { payTo },
      agent: { chainId: 97, tokenId: "4200", name: "Own Agent" },
      ...extra,
    });

  it("refuses a payment that goes back to the wallet that signed it, and relays nothing", async () => {
    const res = await settle(AGENT_WALLET.toUpperCase().replace("0X", "0x"), AGENT_WALLET);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      refused: true,
      ownAgent: true,
      error: "This payment would go back to the wallet that signed it, so it is not a hire.",
    });
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("refuses the owner paying the agent's wallet, even when no terms were asked for", async () => {
    const res = await settle(OWNER, AGENT_WALLET);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      refused: true,
      ownAgent: true,
      error: "Own Agent is your own agent, so this wallet cannot hire it. Use Re-check now on your profile to test it.",
    });
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("refuses a payment named as a hire of an agent it does not pay", async () => {
    const res = await settle(BUYER, ELSEWHERE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      refused: true,
      error: "This payment does not go to Own Agent, so it is not a hire of it.",
    });
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("refuses when the agent cannot be read, rather than trust the caller's own label", async () => {
    store.detail = null;
    const res = await settle(BUYER, AGENT_WALLET);
    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("turns away a label that is not a chain id and a token id, before the registry is read", async () => {
    for (const agent of [
      { chainId: 56, tokenId: "../97/4200", name: "Own Agent" },
      { chainId: "97abc", tokenId: "4200", name: "Own Agent" },
      { chainId: 97, tokenId: { id: 4200 }, name: "Own Agent" },
      { chainId: 97, tokenId: { toString: 1 }, name: "Own Agent" },
      { chainId: 0, tokenId: "4200", name: "Own Agent" },
    ]) {
      const res = await settle(BUYER, AGENT_WALLET, { agent });
      expect(res.status, JSON.stringify(agent)).toBe(400);
    }
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("turns away a payer or a payee that is not a plain address, whatever it could be read as", async () => {
    for (const [from, payTo] of [
      [123, { not: "an address" }],
      // a list holding the owner's address reads as no payer here and as the owner at the relay
      [[OWNER], AGENT_WALLET],
      [BUYER, [AGENT_WALLET]],
      ["", AGENT_WALLET],
      [`${BUYER} `, AGENT_WALLET],
    ]) {
      const res = await post(settleRoute, "/api/x402/settle", {
        paymentPayload: { payload: { authorization: { from } } },
        paymentRequirements: { payTo },
        agent: { chainId: 97, tokenId: "4200", name: "Own Agent" },
      });
      expect(res.status, JSON.stringify([from, payTo])).toBe(400);
    }
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("turns away a payment that names no agent", async () => {
    for (const agent of [undefined, null, "4200"]) {
      const res = await post(settleRoute, "/api/x402/settle", {
        paymentPayload: { payload: { authorization: { from: BUYER } } },
        paymentRequirements: { payTo: AGENT_WALLET },
        agent,
      });
      expect(res.status, JSON.stringify(agent)).toBe(400);
    }
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("relays a buyer's payment to the agent's wallet, in any letter case", async () => {
    const res = await settle(BUYER, AGENT_WALLET.toUpperCase().replace("0X", "0x"), { paymentId: "req_buyer" });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(relay.settleProd).toHaveBeenCalledTimes(1);
  });

  it("lets the marketplace's own check through, paid from its own wallet", async () => {
    store.detail = { ...store.detail, owner_address: RELAY.toLowerCase() };
    const res = await settle(RELAY, AGENT_WALLET, { paymentId: "verify_17a7fc3cbe5b" });
    expect(res.status).toBe(200);
    expect(relay.settleProd).toHaveBeenCalledTimes(1);
  });

  it("does not take a payment for a check because its id says so", async () => {
    const res = await settle(OWNER, AGENT_WALLET, { paymentId: "verify_anything" });
    expect(res.status).toBe(409);
    expect((await res.json()).ownAgent).toBe(true);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("records the registry's name for the agent, not the caller's", async () => {
    await settle(BUYER, AGENT_WALLET, { paymentId: "req_named", agent: { chainId: 97, tokenId: "4200", name: "Some Famous Agent" } });
    expect(relay.settleProd.mock.calls[0][1]).toEqual({ agent: { chainId: 97, tokenId: "4200", name: "Own Agent" } });
  });
});

describe("the passport", () => {
  async function progress(wallet: string) {
    const res = await progressRoute(new NextRequest(`https://api.agentsouk.xyz/api/quest/progress?wallet=${wallet}`));
    return res.json();
  }

  it("does not count a hire that paid the hiring wallet itself", async () => {
    store.payments = [
      { paymentId: "pay_a", activated: true, mode: "prod", agent: { chainId: 97, tokenId: "4200", name: "Own Agent" }, payTo: AGENT_WALLET, createdAt: "2026-10-01T09:00:00Z" },
    ];
    const body = await progress(AGENT_WALLET);
    expect(body.hires).toEqual([]);
    expect(body.points).toBe(0);
  });

  it("still counts the same hire for a buyer who is neither owner nor payee", async () => {
    store.payments = [
      { paymentId: "pay_b", activated: true, mode: "prod", agent: { chainId: 97, tokenId: "4200", name: "Own Agent" }, payTo: AGENT_WALLET, createdAt: "2026-10-01T09:00:00Z" },
    ];
    const body = await progress(BUYER);
    expect(body.categories.yield).toBe(true);
    expect(body.points).toBe(100);
  });
});
