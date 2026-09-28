// The settle response names a job id and status, so a later deliver on another
// instance must find that exact row. Before the fund write was awaited, the
// response returned while the save was still floating and deliver took the
// "no ERC-8183 job exists" branch for a payment it had just been told about.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CLIENT = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const PROVIDER = "0x84fedabd1b83443ad86796c15619494878b64180";
const PAYMENT = "pay_fund_persist_test";

// The durable double commits on write like postgres does, and the payment
// lookup reads committed rows only, so a floating write is visible as missing.
const committed = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));
const gate = vi.hoisted(() => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
});

vi.mock("../src/lib/durable-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/durable-store")>();
  const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
  return {
    ...actual,
    saveJob: vi.fn(async (job: { id: string }) => {
      await gate.promise;
      committed.rows.set(job.id, clone(job));
    }),
    loadJobByPayment: vi.fn(async (paymentId: string) => {
      for (const row of committed.rows.values()) {
        const r = row as { paymentId?: string };
        if (r.paymentId === paymentId) return clone(row);
      }
      return undefined;
    }),
  };
});

vi.mock("../src/lib/facilitator", () => ({
  settleSandbox: vi.fn(async () => ({
    success: true,
    paymentId: PAYMENT,
    details: { client: CLIENT, payTo: PROVIDER },
  })),
  settleProd: vi.fn(async () => ({ success: false, paymentId: "", error: "unused" })),
}));

import { NextRequest } from "next/server";
import { POST } from "../src/app/api/x402/settle/route";
import { loadJobByPayment } from "../src/lib/durable-store";

function settleRequest() {
  return new NextRequest("http://localhost/api/x402/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentPayload: { payload: { authorization: { from: CLIENT } } },
      paymentRequirements: { payTo: PROVIDER },
      agent: { chainId: 97, tokenId: "2504", name: "Souk Health Guard" },
      amountUsd: 2,
    }),
  });
}

describe("settle persists the funded job before responding", () => {
  it("withholds the response until the fund write lands, then reports it", async () => {
    const pending = POST(settleRequest());
    const early = await Promise.race([
      pending.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ]);
    // the old code returned here with the save still floating
    expect(early).toBe("waiting");
    expect(await loadJobByPayment(PAYMENT)).toBeUndefined();

    gate.release();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobStatus).toBe("Funded");

    const stored = (await loadJobByPayment(PAYMENT)) as
      | { id: string; status: string; paymentId: string }
      | undefined;
    expect(stored?.id).toBe(body.jobId);
    expect(stored?.status).toBe("Funded");
  });
});
