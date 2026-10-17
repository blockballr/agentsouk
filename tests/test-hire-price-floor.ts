// The price of a direct hire belongs to the marketplace, not to whoever asks:
// a caller may raise it and never lower it at the terms step, and a
// hand-built requirement that never went through the terms step cannot settle
// below the floor either. The marketplace's own probe signs at the floor, so
// the path it takes still passes
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.TARGET_CHAIN = "97";
  process.env.FACILITATOR_MODE = "prod";
  return { detail: null as Record<string, unknown> | null };
});
const relay = vi.hoisted(() => ({ settleProd: vi.fn() }));

vi.mock("server-only", () => ({}));
// like the registry, it answers only for the chain and token it is asked about
vi.mock("../src/lib/scanner", () => ({
  fetchAgentDetail: async (chainId: number, tokenId: string) => (chainId === 97 && tokenId === "4200" ? store.detail : null),
  queryAgents: async () => ({ items: [], total: 0 }),
}));
vi.mock("../src/lib/facilitator", () => ({ settleProd: relay.settleProd, settleSandbox: vi.fn() }));

import { NextRequest } from "next/server";
import { POST as requirementsRoute } from "../src/app/api/x402/requirements/route";
import { POST as settleRoute } from "../src/app/api/x402/settle/route";

const OWNER = "0x06f757064043e57dbbccd6d95ee1113d9796c715";
const AGENT_WALLET = "0x1111111111111111111111111111111111111111";
const BUYER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const CARD = "https://agent.example/.well-known/agent-card.json";
const SUSD = "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53";
const FLOOR_RAW = "2000000000000000000";

function post(route: (req: NextRequest) => Promise<Response>, path: string, body: unknown) {
  return route(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  store.detail = {
    token_id: "4200",
    chain_id: 97,
    name: "Priced Agent",
    owner_address: OWNER,
    agent_wallet: AGENT_WALLET,
    a2a_endpoint: CARD,
  };
  relay.settleProd.mockReset();
  relay.settleProd.mockImplementation(async () => ({ success: true, paymentId: "pay_relayed" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ name: "Priced Agent", skills: [{ name: "run", description: "Runs a session" }] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function askPrice(amountUsd?: unknown) {
  const body: Record<string, unknown> = { chainId: 97, tokenId: "4200", client: BUYER };
  if (amountUsd !== undefined) body.amountUsd = amountUsd;
  const res = await post(requirementsRoute, "/api/x402/requirements", body);
  return { status: res.status, body: await res.json() };
}

function settleAt(amount?: string) {
  const requirements: Record<string, unknown> = {
    scheme: "exact",
    network: "eip155:97",
    asset: SUSD,
    payTo: AGENT_WALLET,
    maxTimeoutSeconds: 300,
    extra: { name: "Agent Souk Test USD", version: "1", assetTransferMethod: "eip3009" },
  };
  if (amount !== undefined) requirements.amount = amount;
  const value = amount ?? "";
  return post(settleRoute, "/api/x402/settle", {
    paymentId: "pay_crafted",
    paymentRequirements: requirements,
    paymentPayload: {
      payload: {
        authorization: {
          from: BUYER,
          to: AGENT_WALLET,
          value,
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"ab".repeat(32)}`,
          signature: `0x${"11".repeat(65)}`,
        },
      },
    },
    agent: { chainId: 97, tokenId: "4200", name: "Priced Agent" },
  });
}

describe("the terms step price", () => {
  it("holds the marketplace floor against a lower or malformed ask", async () => {
    for (const ask of [0.01, 0, -5, "abc", null]) {
      const { status, body } = await askPrice(ask);
      expect(status).toBe(200);
      expect(body.data.paymentRequirements.amount).toBe(FLOOR_RAW);
      expect(body.data.preview.options[0].amountUsd).toBe(2);
    }
  });

  it("falls back to the marketplace price when no price is named", async () => {
    const { status, body } = await askPrice();
    expect(status).toBe(200);
    expect(body.data.paymentRequirements.amount).toBe(FLOOR_RAW);
  });

  it("lets a caller raise the price", async () => {
    const { status, body } = await askPrice(10);
    expect(status).toBe(200);
    expect(body.data.paymentRequirements.amount).toBe("10000000000000000000");
    expect(body.data.preview.options[0].amountUsd).toBe(10);
  });
});

describe("a hand-built requirement", () => {
  it("is refused below the floor, before the relay is asked", async () => {
    const res = await settleAt("1000000000000000000");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.refused).toBe(true);
    expect(body.error).toBe("This payment pays less than the marketplace price of $2, so it cannot settle.");
    expect(relay.settleProd).not.toHaveBeenCalled();
  });

  it("is refused when the amount is missing or malformed", async () => {
    for (const amount of [undefined, "nope"]) {
      const res = await settleAt(amount);
      expect(res.status).toBe(409);
      expect(relay.settleProd).not.toHaveBeenCalled();
    }
  });

  it("settles at the floor, which is how the marketplace's own probe pays", async () => {
    const res = await settleAt(FLOOR_RAW);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(relay.settleProd).toHaveBeenCalledTimes(1);
  });
});
