// The hire bookkeeping chain, end to end and in process: record and activate a
// payment, settle it into an ERC-8183 job plus a hire task, run the task to a
// terminal state, grade the delivery, and revoke. No chain, no database, no
// network: the settle route's own verification and the lib stores are real, and
// only the two outbound edges (latest block read, agent registry read) are cut.
import { afterEach, describe, expect, it, vi } from "vitest";

// receipts/tasks/jobs stores read env and open a driver at import time; pin the
// in-memory path before any module is evaluated.
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.RECEIPTS_STORE = "memory";
  process.env.FACILITATOR_MODE = "sandbox";
  process.env.TARGET_CHAIN = "56";
});

vi.mock("server-only", () => ({}));

// The settlement path only reaches the chain to read the latest block for the
// EIP-3009 time window; replace that one call so verification stays local.
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    }),
  };
});

// route.ts and delivery.ts reach lib code through the "@/" alias, which this
// vitest config does not resolve. Point each alias at the real relative module
// so the route and delivery run the real implementations, not stand-ins.
vi.mock("@/lib/facilitator", async () => await import("../src/lib/facilitator"));
vi.mock("@/lib/facilitator-mode", async () => await import("../src/lib/facilitator-mode"));
vi.mock("@/lib/x402", async () => await import("../src/lib/x402"));
vi.mock("@/lib/tasks", async () => await import("../src/lib/tasks"));
vi.mock("@/lib/jobs", async () => await import("../src/lib/jobs"));
vi.mock("@/lib/receipts-store", async () => await import("../src/lib/receipts-store"));

const scannerMock = vi.hoisted(() => ({ fetchAgentDetail: vi.fn() }));
vi.mock("@/lib/scanner", () => scannerMock);
vi.mock("@/lib/endpoint", () => ({ privateEndpointReason: () => null }));

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { SESSION_HOURS, SESSION_SPEND_CAP_USD } from "@agora/core";
import {
  EIP3009_TYPES,
  eip3009Domain,
  findActiveSession,
  getPayment,
  listActiveSessions,
  randomNonce,
  recordPayment,
  type PaymentRequirements,
} from "../src/lib/x402";
import { revokeSessionDurable } from "../src/lib/receipts-store";
import { getTask } from "../src/lib/tasks";
import { getJob } from "../src/lib/jobs";
import { scoreDelivery } from "../src/lib/quality";
import { settlementAsset } from "../src/lib/types";
import { deliver } from "../src/lib/delivery";
import { POST as settleRoute } from "../src/app/api/x402/settle/route";
import { DELETE as revokeRoute } from "../src/app/api/sessions/route";

const CHAIN_ID = 56;
const asset = settlementAsset(CHAIN_ID);
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY_TO = "0x2222222222222222222222222222222222222222";
const AMOUNT_RAW = "2000000000000000000";

let paymentSeq = 0;
function nextPaymentId(label: string): string {
  paymentSeq += 1;
  return `${label}-${Date.now()}-${paymentSeq}`;
}

async function signedSettleBody(paymentId: string) {
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: `eip155:${CHAIN_ID}`,
    amount: AMOUNT_RAW,
    asset: asset.address,
    payTo: PAY_TO,
    maxTimeoutSeconds: 600,
    extra: {
      name: asset.eip712Name,
      version: asset.eip712Version,
      assetTransferMethod: "eip3009",
    },
  };
  const message = {
    from: buyer.address,
    to: PAY_TO as `0x${string}`,
    value: BigInt(AMOUNT_RAW),
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: randomNonce(),
  };
  const signature = await buyer.signTypedData({
    domain: eip3009Domain(requirements),
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const resource = {
    url: `https://agents.example/${paymentId}`,
    description: "hire",
    mimeType: "application/json",
  };
  return {
    paymentId,
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: message.from,
          to: message.to,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce: message.nonce,
          signature,
        },
        resource,
      },
      resource,
      accepted: requirements,
    },
    paymentRequirements: requirements,
    agent: { chainId: CHAIN_ID, tokenId: "42", name: "Local Grid Bot", symbol: asset.symbol },
    amountUsd: 2,
  };
}

async function settleHire(
  paymentId: string,
  agent?: { tokenId: string; name: string },
) {
  const body = await signedSettleBody(paymentId);
  if (agent) {
    body.agent = { chainId: CHAIN_ID, tokenId: agent.tokenId, name: agent.name, symbol: asset.symbol };
  }
  const res = await settleRoute(
    new NextRequest("http://localhost/api/x402/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const json = await res.json();
  return { res, json };
}

// One fake MCP endpoint: initialize answers, tools/call answers from `toolResult`.
function stubMcp(toolResult: Record<string, unknown>) {
  return async (_input: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as {
      id?: number;
      method: string;
    };
    const payload =
      req.method === "tools/call"
        ? toolResult
        : { jsonrpc: "2.0", id: req.id, result: {} };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  scannerMock.fetchAgentDetail.mockReset();
});

describe("a payment must be activated before it can be drawn on", () => {
  it("refuses a payment that was never recorded", async () => {
    const out = await deliver({ paymentId: "never-recorded-payment", task: "do work" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/no settled session/i);
  });

  it("refuses a recorded but unactivated payment", async () => {
    const paymentId = nextPaymentId("unactivated");
    recordPayment({
      paymentId,
      createdAt: new Date().toISOString(),
      txHash: `0x${"ab".repeat(32)}`,
      mode: "sandbox",
      agent: { chainId: CHAIN_ID, tokenId: "43", name: "Recorded" },
      client: buyer.address,
      payTo: PAY_TO,
      amount: AMOUNT_RAW,
      symbol: asset.symbol,
      activated: false,
      session: {
        spendCapUsd: SESSION_SPEND_CAP_USD,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const out = await deliver({ paymentId, tool: "rebalance" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/no settled session/i);
    expect(listActiveSessions().some((s) => s.paymentId === paymentId)).toBe(false);
  });
});

describe("settle opens the job and the task from the settled terms", () => {
  it("opens a Funded job and a ready task linked to the receipt", async () => {
    const paymentId = nextPaymentId("settle");
    const { res, json } = await settleHire(paymentId);

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.jobStatus).toBe("Funded");

    const receipt = getPayment(paymentId);
    expect(receipt?.activated).toBe(true);

    const task = getTask(json.taskId);
    expect(task?.status).toBe("ready");
    expect(task?.paymentId).toBe(paymentId);

    const job = getJob(json.jobId);
    expect(job?.status).toBe("Funded");
    expect(job?.paymentId).toBe(paymentId);
    expect(job?.client).toBe(buyer.address);
    // evaluator defaults to the client, so the hirer can attest the work
    expect(job?.evaluator).toBe(buyer.address);
    expect(job?.budgetUsd).toBe(2);
    expect(job?.history.some((h) => h.status === "Funded" && h.reason === "x402 settlement")).toBe(true);

    // the cap and expiry live on the settled receipt, not on HireTask
    expect(receipt?.session.spendCapUsd).toBe(SESSION_SPEND_CAP_USD);
    const expiresMs = new Date(receipt!.session.expiresAt).getTime();
    const createdAtMs = new Date(receipt!.createdAt).getTime();
    expect(expiresMs - createdAtMs).toBe(SESSION_HOURS * 60 * 60 * 1000);

    const active = listActiveSessions().find((s) => s.paymentId === paymentId);
    expect(active?.spendCapUsd).toBe(SESSION_SPEND_CAP_USD);
    expect(active?.expiresAt).toBe(receipt?.session.expiresAt);
  });
});

describe("task lifecycle", () => {
  it("moves ready to running to failed and records why", async () => {
    const paymentId = nextPaymentId("fail");
    const { json } = await settleHire(paymentId);
    scannerMock.fetchAgentDetail.mockResolvedValue({
      mcp_server: "https://agent.example/mcp",
      a2a_endpoint: null,
    });
    vi.stubGlobal(
      "fetch",
      stubMcp({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "grid offline" } }),
    );

    const out = await deliver({ paymentId, tool: "rebalance", args: {} });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/tools\/call failed/i);

    const task = getTask(json.taskId);
    expect(task?.status).toBe("failed");
    expect(task?.error).toMatch(/tools\/call failed/i);
    const states = task!.history.map((h) => h.status);
    expect(states).toContain("ready");
    expect(states).toContain("running");
    expect(states[states.length - 1]).toBe("failed");
    expect(task!.history[task!.history.length - 1].note).toMatch(/tools\/call failed/i);
  });

  it("stores the grade it computed for the returned text", async () => {
    const paymentId = nextPaymentId("deliver");
    const { json } = await settleHire(paymentId);
    const deliveredText = "Allocated 40% to Aave, 60% to Lista at 14% APY";
    scannerMock.fetchAgentDetail.mockResolvedValue({
      mcp_server: "https://agent.example/mcp",
      a2a_endpoint: null,
    });
    vi.stubGlobal(
      "fetch",
      stubMcp({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: deliveredText }] },
      }),
    );

    const out = await deliver({ paymentId, tool: "rebalance", args: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const task = getTask(json.taskId);
    expect(task?.status).toBe("delivered");
    expect(task?.result).toBe(deliveredText);
    // the stored grade is exactly the one scoreDelivery computes for that text
    expect(task?.quality).toEqual(scoreDelivery(deliveredText));
    expect(task?.quality?.grade).toBe(scoreDelivery(deliveredText).grade);
    // delivery also advances the ERC-8183 job to Submitted
    expect(getJob(json.jobId)?.status).toBe("Submitted");
  });
});

describe("revoking a settled session", () => {
  it("stops it being listed as active", async () => {
    const paymentId = nextPaymentId("revoke");
    const tokenId = "9901";
    await settleHire(paymentId, { tokenId, name: "Revocable" });

    expect(listActiveSessions().some((s) => s.paymentId === paymentId)).toBe(true);
    expect(findActiveSession(CHAIN_ID, tokenId)).toBeDefined();

    expect(await revokeSessionDurable(paymentId)).toBe(true);
    expect(getPayment(paymentId)?.activated).toBe(false);
    expect(listActiveSessions().some((s) => s.paymentId === paymentId)).toBe(false);
    expect(findActiveSession(CHAIN_ID, tokenId)).toBeUndefined();
  });

  it("reports an unknown payment as unknown", async () => {
    const res = await revokeRoute(
      new NextRequest("http://localhost/api/sessions?paymentId=does-not-exist"),
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/unknown/i);
    expect(await revokeSessionDurable("does-not-exist")).toBe(false);
  });
});
