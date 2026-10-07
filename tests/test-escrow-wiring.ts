// The funded-hire wiring: with the funder deployed, a hire's signed recipient is
// the escrow contract and the agent's wallet rides beside it, the settle step
// binds that wallet to the registry before spending, and a payment that avoids
// the escrow while it is configured cannot settle at all. Without the funder,
// everything reads exactly as it did before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  process.env.FACILITATOR_MODE = "prod";
  return { detail: null as Record<string, unknown> | null };
});
const relay = vi.hoisted(() => ({ settleProd: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/scanner", () => ({
  fetchAgentDetail: async (chainId: number, tokenId: string) =>
    chainId === 97 && tokenId === "4200" ? store.detail : null,
  queryAgents: async () => ({ items: [], total: 0 }),
}));
vi.mock("../src/lib/facilitator", () => ({ settleProd: relay.settleProd, settleSandbox: vi.fn() }));
vi.mock("../src/lib/receipts-store", () => ({
  listPaymentsByClient: async () => [],
  receiptsMode: () => "memory",
}));

import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { POST as requirementsRoute } from "../src/app/api/x402/requirements/route";
import { POST as settleRoute } from "../src/app/api/x402/settle/route";
import { escrowTermsFor, escrowJobId } from "../src/lib/escrow";

const FUNDER = getAddress(`0x9c0deab5${"0".repeat(31)}1`);
const AGENT_WALLET = "0x1111111111111111111111111111111111111111";
const BUYER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const CARD = "https://agent.example/.well-known/agent-card.json";

function post(
  route: (req: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
) {
  return route(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function settleBody(payTo: string, agentPayTo?: string) {
  return {
    paymentId: "req_wiring_case",
    agent: { chainId: 97, tokenId: "4200", name: "Own Agent" },
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: { from: BUYER, to: payTo, value: "2000000000000000000" },
        resource: { url: "/agents/97/4200", description: "hire", mimeType: "application/json" },
      },
      resource: { url: "/agents/97/4200", description: "hire", mimeType: "application/json" },
      accepted: { payTo },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "eip155:97",
      amount: "2000000000000000000",
      asset: "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53",
      payTo,
      maxTimeoutSeconds: 300,
      extra: {
        name: "Agent Souk Test USD",
        version: "1",
        assetTransferMethod: "eip3009",
        ...(agentPayTo ? { agentPayTo } : {}),
      },
    },
  };
}

beforeEach(() => {
  store.detail = {
    token_id: "4200",
    chain_id: 97,
    name: "Own Agent",
    owner_address: AGENT_WALLET,
    agent_wallet: AGENT_WALLET,
    a2a_endpoint: CARD,
  };
  relay.settleProd.mockReset();
  relay.settleProd.mockImplementation(async (body: { paymentId?: string }) => ({
    success: true,
    paymentId: body.paymentId ?? "pay_relayed",
    details: { client: BUYER, payTo: AGENT_WALLET },
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ name: "Own Agent", skills: [{ name: "plan", description: "Plans a grid" }] }), { status: 200 }),
    ),
  );
});

afterEach(() => {
  delete process.env.ESCROW_FUNDER_ADDRESS;
  vi.unstubAllGlobals();
});

describe("escrow terms", () => {
  it("do not exist with no funder configured", () => {
    expect(escrowTermsFor(FUNDER, AGENT_WALLET)).toBeNull();
  });

  it("exist only when the signed recipient is the funder and an agent wallet is named", () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    expect(escrowTermsFor(FUNDER, AGENT_WALLET)).toEqual({
      funder: FUNDER,
      agentPayTo: AGENT_WALLET,
    });
    // a payee that is not the funder, and a missing or malformed wallet, both read
    // as no terms, which is what routes the settle down the refused path
    expect(escrowTermsFor(AGENT_WALLET, AGENT_WALLET)).toBeNull();
    expect(escrowTermsFor(FUNDER, "")).toBeNull();
    expect(escrowTermsFor(FUNDER, "not-an-address")).toBeNull();
  });

  it("keys both contracts by the payment id", () => {
    expect(escrowJobId("req_abc")).toBe(escrowJobId("req_abc"));
    expect(escrowJobId("req_abc")).not.toBe(escrowJobId("req_abd"));
    expect(escrowJobId("req_abc")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("hire terms", () => {
  it("name the agent wallet directly with no funder configured", async () => {
    const res = await post(requirementsRoute, "/api/x402/requirements", {
      chainId: 97,
      tokenId: "4200",
      client: BUYER,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paymentRequirements.payTo).toBe(AGENT_WALLET);
    expect(body.data.paymentRequirements.extra.agentPayTo).toBeUndefined();
  });

  it("name the funder with the agent wallet beside it once the funder is deployed", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(requirementsRoute, "/api/x402/requirements", {
      chainId: 97,
      tokenId: "4200",
      client: BUYER,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paymentRequirements.payTo).toBe(FUNDER);
    expect(body.data.paymentRequirements.extra.agentPayTo).toBe(AGENT_WALLET);
  });

  it("never escrow the marketplace's own check", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(requirementsRoute, "/api/x402/requirements", {
      chainId: 97,
      tokenId: "4200",
      client: BUYER,
      purpose: "check",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.paymentRequirements.payTo).toBe(AGENT_WALLET);
    expect(body.data.paymentRequirements.extra.agentPayTo).toBeUndefined();
  });
});

describe("settlement", () => {
  it("refuses a real hire that pays around a configured escrow", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(settleRoute, "/api/x402/settle", settleBody(AGENT_WALLET));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("escrow");
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("refuses a payment to a funder with no agent wallet named beside it", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(settleRoute, "/api/x402/settle", settleBody(FUNDER));
    expect(res.status).toBe(409);
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("settles an escrowed hire once the registry binds the named wallet", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(settleRoute, "/api/x402/settle", settleBody(FUNDER, AGENT_WALLET));
    expect(res.status).toBe(200);
    expect(relay.settleProd).toHaveBeenCalled();
  });

  it("settles a direct hire when no funder is configured", async () => {
    const res = await post(settleRoute, "/api/x402/settle", settleBody(AGENT_WALLET));
    expect(res.status).toBe(200);
    expect(relay.settleProd).toHaveBeenCalled();
  });

  it("refuses an escrowed hire whose named wallet is not the agent's", async () => {
    process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
    const res = await post(
      settleRoute,
      "/api/x402/settle",
      settleBody(FUNDER, "0x2222222222222222222222222222222222222222"),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("does not go to");
    expect(relay.settleProd).not.toHaveBeenCalled();
  });
});
