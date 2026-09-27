// The ERC-8183 job lifecycle must only move when the wallet that the state requires
// signs the action. These drive the POST route directly and pin the four refusals:
// no signature, wrong signer, a signature bound to another action or job, and an
// action the state does not allow. The stores run in memory.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.RECEIPTS_STORE = "memory";
});

vi.mock("server-only", () => ({}));

// route.ts reaches the store through the "@/" alias, which this vitest config does
// not resolve; point it at the real module so the route and the test share one map.
vi.mock("@/lib/jobs", async () => await import("../src/lib/jobs"));

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import {
  createJob,
  fundJob,
  getJob,
  jobActionMessage,
  submitJob,
  type Job,
} from "../src/lib/jobs";
import { POST } from "../src/app/api/jobs/[jobId]/route";

const client = privateKeyToAccount(`0x${"11".repeat(32)}`);
const provider = privateKeyToAccount(`0x${"22".repeat(32)}`);
const evaluator = privateKeyToAccount(`0x${"33".repeat(32)}`);
const attacker = privateKeyToAccount(`0x${"44".repeat(32)}`);

function openJob(): Job {
  return createJob({
    client: client.address,
    provider: provider.address,
    evaluator: evaluator.address,
    description: "rebalance the pool",
    chainId: 56,
    tokenId: "1",
    agentName: "Test Agent",
    budgetUsd: 2,
  });
}

let paymentSeq = 0;

function fundedJob(opts: { evaluator?: string; expiredAt?: string } = {}): Job {
  paymentSeq += 1;
  return fundJob({
    paymentId: `job-auth-${Date.now()}-${paymentSeq}`,
    client: client.address,
    provider: provider.address,
    evaluator: opts.evaluator ?? evaluator.address,
    description: "rebalance the pool",
    chainId: 56,
    tokenId: "1",
    agentName: "Test Agent",
    budgetUsd: 2,
    expiredAt: opts.expiredAt,
  });
}

async function post(jobId: string, body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/jobs/${jobId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) },
  );
}

async function sign(
  account: ReturnType<typeof privateKeyToAccount>,
  input: {
    jobId: string;
    action: "complete" | "reject" | "submit" | "claimRefund";
    address: string;
    reason?: string;
    deliverable?: string;
  },
) {
  const message = jobActionMessage(input);
  const signature = await account.signMessage({ message });
  return { message, signature };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("canonical job action message", () => {
  it("carries the job, the action, the address, the reason and the deliverable", () => {
    const message = jobActionMessage({
      jobId: "job-1",
      action: "complete",
      address: "0xAABBccDDeeFF00112233445566778899aabbccdd",
      reason: "looks right",
      deliverable: "did the work",
    });
    expect(message).toBe(
      [
        "Agent Souk job action",
        "jobId: job-1",
        "action: complete",
        "address: 0xaabbccddeeff00112233445566778899aabbccdd",
        "reason: looks right",
        "deliverable: did the work",
      ].join("\n"),
    );
  });

  it("signs an empty reason and deliverable when they are absent", () => {
    const message = jobActionMessage({
      jobId: "job-1",
      action: "reject",
      address: "0xabc",
    });
    expect(message).toContain("reason: \n");
    expect(message).toContain("deliverable: ");
  });
});

describe("no signature", () => {
  it("refuses a complete with no signature and leaves the job untouched", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const res = await post(job.id, { action: "complete", by: evaluator.address });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Submitted");
  });

  it("refuses a claimRefund with no signature", async () => {
    const job = fundedJob({ expiredAt: new Date(Date.now() - 1000).toISOString() });
    const res = await post(job.id, { action: "claimRefund", by: client.address });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Funded");
  });

  it("refuses a request with no acting address", async () => {
    const job = fundedJob();
    const res = await post(job.id, { action: "reject" });
    expect(res.status).toBe(401);
  });
});

describe("the signer must be the party the action requires", () => {
  it("refuses a complete signed by an address that is not the evaluator", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const { signature } = await sign(attacker, {
      jobId: job.id,
      action: "complete",
      address: attacker.address,
    });
    const res = await post(job.id, {
      action: "complete",
      by: attacker.address,
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Submitted");
  });

  it("refuses a reject on a Funded job signed by the client rather than the evaluator", async () => {
    const job = fundedJob();
    const { signature } = await sign(client, {
      jobId: job.id,
      action: "reject",
      address: client.address,
      reason: "changed my mind",
    });
    const res = await post(job.id, {
      action: "reject",
      by: client.address,
      reason: "changed my mind",
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Funded");
  });

  it("refuses a submit signed by an address that is not the provider, so a deliverable cannot be overwritten", async () => {
    const job = fundedJob();
    const { signature } = await sign(attacker, {
      jobId: job.id,
      action: "submit",
      address: attacker.address,
      deliverable: "malicious replacement",
    });
    const res = await post(job.id, {
      action: "submit",
      by: attacker.address,
      deliverable: "malicious replacement",
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Funded");
    expect(getJob(job.id)?.deliverable).toBeUndefined();
  });

  it("refuses a claimRefund signed by an address that is not the client", async () => {
    const job = fundedJob({ expiredAt: new Date(Date.now() - 1000).toISOString() });
    const { signature } = await sign(attacker, {
      jobId: job.id,
      action: "claimRefund",
      address: attacker.address,
    });
    const res = await post(job.id, {
      action: "claimRefund",
      by: attacker.address,
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Funded");
  });
});

describe("a signature is bound to one action on one job", () => {
  it("refuses an evaluator signature made for another action", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const { signature } = await sign(evaluator, {
      jobId: job.id,
      action: "reject",
      address: evaluator.address,
      reason: "no good",
    });
    const res = await post(job.id, {
      action: "complete",
      by: evaluator.address,
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(job.id)?.status).toBe("Submitted");
  });

  it("refuses an evaluator signature made for another job", async () => {
    const first = fundedJob();
    const second = fundedJob();
    submitJob({ jobId: first.id, provider: provider.address, deliverable: "one" });
    submitJob({ jobId: second.id, provider: provider.address, deliverable: "two" });

    const { signature } = await sign(evaluator, {
      jobId: first.id,
      action: "complete",
      address: evaluator.address,
    });
    const res = await post(second.id, {
      action: "complete",
      by: evaluator.address,
      signature,
    });
    expect(res.status).toBe(401);
    expect(getJob(second.id)?.status).toBe("Submitted");
  });
});

describe("an allowed action with the right signer", () => {
  it("completes when the evaluator signs", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const { signature } = await sign(evaluator, {
      jobId: job.id,
      action: "complete",
      address: evaluator.address,
      reason: "approved",
    });
    const res = await post(job.id, {
      action: "complete",
      by: evaluator.address,
      reason: "approved",
      signature,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.job.status).toBe("Completed");
    expect(body.job.attestation).toBe("approved");
  });

  it("rejects a Submitted job when the evaluator signs", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const { signature } = await sign(evaluator, {
      jobId: job.id,
      action: "reject",
      address: evaluator.address,
      reason: "poor quality",
    });
    const res = await post(job.id, {
      action: "reject",
      by: evaluator.address,
      reason: "poor quality",
      signature,
    });
    expect(res.status).toBe(200);
    expect(getJob(job.id)?.status).toBe("Rejected");
  });

  it("lets the client reject an Open job before work starts", async () => {
    const job = openJob();
    const { signature } = await sign(client, {
      jobId: job.id,
      action: "reject",
      address: client.address,
      reason: "cancelled",
    });
    const res = await post(job.id, {
      action: "reject",
      by: client.address,
      reason: "cancelled",
      signature,
    });
    expect(res.status).toBe(200);
    expect(getJob(job.id)?.status).toBe("Rejected");
  });

  it("submits when the provider signs and records the deliverable", async () => {
    const job = fundedJob();
    const { signature } = await sign(provider, {
      jobId: job.id,
      action: "submit",
      address: provider.address,
      deliverable: "60/40 split recorded",
    });
    const res = await post(job.id, {
      action: "submit",
      by: provider.address,
      deliverable: "60/40 split recorded",
      signature,
    });
    expect(res.status).toBe(200);
    expect(getJob(job.id)?.status).toBe("Submitted");
    expect(getJob(job.id)?.deliverable).toBe("60/40 split recorded");
  });

  it("expires a funded job when the client claims the refund after expiry", async () => {
    const job = fundedJob({ expiredAt: new Date(Date.now() - 1000).toISOString() });
    const { signature } = await sign(client, {
      jobId: job.id,
      action: "claimRefund",
      address: client.address,
    });
    const res = await post(job.id, {
      action: "claimRefund",
      by: client.address,
      signature,
    });
    expect(res.status).toBe(200);
    expect(getJob(job.id)?.status).toBe("Expired");
  });
});

describe("an action the state does not allow is a 409, not a 200", () => {
  it("refuses to complete a Funded job", async () => {
    const job = fundedJob();
    const { signature } = await sign(evaluator, {
      jobId: job.id,
      action: "complete",
      address: evaluator.address,
    });
    const res = await post(job.id, {
      action: "complete",
      by: evaluator.address,
      signature,
    });
    expect(res.status).toBe(409);
    expect(getJob(job.id)?.status).toBe("Funded");
  });

  it("refuses to submit a job that is already Submitted", async () => {
    const job = fundedJob();
    submitJob({ jobId: job.id, provider: provider.address, deliverable: "done" });

    const { signature } = await sign(provider, {
      jobId: job.id,
      action: "submit",
      address: provider.address,
      deliverable: "again",
    });
    const res = await post(job.id, {
      action: "submit",
      by: provider.address,
      deliverable: "again",
      signature,
    });
    expect(res.status).toBe(409);
    expect(getJob(job.id)?.deliverable).toBe("done");
  });

  it("refuses a reject on a terminal job", async () => {
    const job = fundedJob();
    const signedReject = await sign(evaluator, {
      jobId: job.id,
      action: "reject",
      address: evaluator.address,
      reason: "cancelled",
    });
    await post(job.id, {
      action: "reject",
      by: evaluator.address,
      reason: "cancelled",
      signature: signedReject.signature,
    });
    expect(getJob(job.id)?.status).toBe("Rejected");

    const res = await post(job.id, {
      action: "reject",
      by: evaluator.address,
      reason: "again",
      signature: signedReject.signature,
    });
    expect(res.status).toBe(409);
  });

  it("refuses a refund while the job is still within its window", async () => {
    const job = fundedJob({ expiredAt: new Date(Date.now() + 3600_000).toISOString() });
    const res = await post(job.id, { action: "claimRefund", by: client.address, signature: "0x00" });
    expect(res.status).toBe(409);
  });

  it("refuses an unknown action and a missing job", async () => {
    const job = fundedJob();
    expect((await post(job.id, { action: "delete" })).status).toBe(400);
    expect((await post("no-such-job", { action: "complete" })).status).toBe(404);
  });
});

describe("submitJob refuses a non-provider at the store boundary", () => {
  it("returns undefined and does not overwrite the deliverable", () => {
    const job = fundedJob();
    const out = submitJob({
      jobId: job.id,
      provider: attacker.address,
      deliverable: "stolen",
    });
    expect(out).toBeUndefined();
    expect(getJob(job.id)?.status).toBe("Funded");
    expect(getJob(job.id)?.deliverable).toBeUndefined();
  });
});
