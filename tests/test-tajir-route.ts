// Tajir Al Souk as served: the card names one identity with the plan skill and
// both ERC-8183 steps, the endpoint answers negotiate with a wallet-signed
// quote in the kernel's payment token, and a plain plan request still plans.
// The token id inside the quote is null until this listing mints on its chain.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TARGET_CHAIN = "97";
  process.env.SELLER8183_PRIVATE_KEY_TESTNET = `0x${"33".repeat(32)}`;
  process.env.SELLER8183_PROVIDER_TESTNET = "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB";
});

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { takesJobs } from "@agora/core";
import { tajirAgentCard } from "../src/lib/tajir-agent";
import { POST } from "../src/app/api/tajir/a2a/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/tajir/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function negotiateMessage() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        parts: [
          { kind: "text", text: "rebalance the position" },
          {
            kind: "data",
            data: {
              skill: "negotiate",
              task_description: "Plan a grid from lower 1000 to upper 2000 with 11 levels and 100 per order",
              terms: { deliverables: "the plan as the job's deliverable", quality_standards: "every figure reproducible" },
            },
          },
        ],
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the trading agent's card", () => {
  it("carries one name, the plan skill and both job steps", () => {
    const card = tajirAgentCard("https://api.agentsouk.xyz");
    expect(card.name).toBe("Tajir Al Souk");
    expect(card.version).toBe("1.0.0");
    expect(card.skills.map((s) => s.id)).toEqual(["plan_grid", "negotiate", "notify_funded"]);
    // the job branch reads the card for the protocol, so this card must pass it
    expect(takesJobs(card.skills)).toBe(true);
    expect(card.url).toBe("https://api.agentsouk.xyz/api/tajir/a2a");
    expect(card.description).toContain("trades");
  });
});

describe("the trading agent's a2a endpoint", () => {
  it("answers negotiate with a signed quote in the kernel's payment token", async () => {
    const res = await POST(post(negotiateMessage()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.status).toBe("quoted");
    expect(body.result.provider_address).toBe("0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB");
    expect(body.result.provider_sig).toMatch(/^0x[0-9a-f]+$/i);
    expect(body.result.price).toMatch(/^\d+$/);
    expect(body.result.currency).toMatch(/^0x[0-9a-f]{40}$/i);
    expect(body.result.negotiation_hash).toMatch(/^0x[0-9a-f]{64}$/i);
    // null until TAJIR_AGENT_TOKEN_IDS carries this chain's minted id
    expect(body.result.agent_id).toBeNull();
  });

  it("still plans a plain task with no seller step addressed", async () => {
    const res = await POST(
      post({
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: {
          message: {
            role: "user",
            kind: "message",
            parts: [
              { kind: "text", text: "Plan a grid over a range" },
              {
                kind: "data",
                data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100 } },
              },
            ],
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.task.status.state).toBe("completed");
    const artifact = body.result.task.artifacts[0].parts[0].data;
    expect(artifact.action).toBe("plan_grid");
    expect(artifact.result.spacingUsd).toBe(100);
  });
});
