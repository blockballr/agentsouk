// The ERC-8183 mutators stay synchronous, so a request whose whole point is a state
// transition must await the durable write before it returns. These tests gate the
// write that carries the new status on a deferred: a caller that leaves it floating
// returns while the store still holds the old status. The fake store clones on write,
// as postgres does, so an in-memory mutation is not mistaken for a persisted one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.RECEIPTS_STORE = "memory";
});

vi.mock("server-only", () => ({}));

interface StoredJob {
  id: string;
  paymentId?: string;
  client: string;
  provider: string;
  evaluator: string;
  status: string;
  chainId: number;
  updatedAt: string;
  deliverable?: string;
  attestation?: string;
  history: { at: string; status: string; by: string; reason?: string }[];
  [key: string]: unknown;
}

interface StoredTask {
  id: string;
  paymentId: string;
  status: string;
  attempts: number;
  updatedAt: string;
  [key: string]: unknown;
}

const store = vi.hoisted(() => ({
  jobs: new Map<string, StoredJob>(),
  jobByPayment: new Map<string, string>(),
  tasks: new Map<string, StoredTask>(),
  taskByPayment: new Map<string, string>(),
}));

// gating only the write that carries the new status lets the earlier cache write of
// the old status through, so the queued write under test is the transition itself.
const gate = vi.hoisted(() => ({
  transition: "",
  pending: [] as Array<() => void>,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

vi.mock("../src/lib/durable-store", () => ({
  durableMode: () => "memory",
  saveJob: async (job: StoredJob) => {
    if (gate.transition && job.status === gate.transition) {
      await new Promise<void>((resolve) => gate.pending.push(resolve));
    }
    store.jobs.set(job.id, clone(job));
    if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
  },
  loadJob: async (id: string) => {
    const job = store.jobs.get(id);
    return job ? clone(job) : undefined;
  },
  loadJobByPayment: async (paymentId: string) => {
    const id = store.jobByPayment.get(paymentId);
    const job = id ? store.jobs.get(id) : undefined;
    return job ? clone(job) : undefined;
  },
  loadJobs: async () => [...store.jobs.values()].map(clone),
  loadJobsByClient: async (client: string) =>
    [...store.jobs.values()]
      .filter((j) => j.client.toLowerCase() === client.toLowerCase())
      .map(clone),
  // delivery.ts reaches the task store through the same durable module
  saveHireTask: async (task: StoredTask) => {
    store.tasks.set(task.id, clone(task));
    store.taskByPayment.set(task.paymentId, task.id);
  },
  loadHireTask: async (id: string) => {
    const task = store.tasks.get(id);
    return task ? clone(task) : undefined;
  },
  loadHireTaskByPayment: async (paymentId: string) => {
    const id = store.taskByPayment.get(paymentId);
    const task = id ? store.tasks.get(id) : undefined;
    return task ? clone(task) : undefined;
  },
  loadHireTasks: async () => [...store.tasks.values()].map(clone),
  insertHireTaskIfAbsent: async (task: StoredTask) => {
    if (store.taskByPayment.has(task.paymentId)) return undefined;
    store.tasks.set(task.id, clone(task));
    store.taskByPayment.set(task.paymentId, task.id);
    return clone(task);
  },
}));

// delivery reaches the registry, the endpoint guard and the receipts store here
const scanner = vi.hoisted(() => ({ fetchAgentDetail: vi.fn() }));
vi.mock("@/lib/scanner", () => scanner);
vi.mock("@/lib/endpoint", () => ({ privateEndpointReason: () => null }));
const receipts = vi.hoisted(() => ({ getPaymentDurable: vi.fn() }));
vi.mock("../src/lib/receipts-store", () => receipts);

// route.ts reaches the store through the "@/" alias; pin it at the real module so
// the route and this test share one in-memory job map.
vi.mock("@/lib/jobs", async () => await import("../src/lib/jobs"));

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { getJob, jobActionMessage, type Job } from "../src/lib/jobs";
import { deliver } from "../src/lib/delivery";
import { POST } from "../src/app/api/jobs/[jobId]/route";

const client = privateKeyToAccount(`0x${"11".repeat(32)}`);
const provider = privateKeyToAccount(`0x${"22".repeat(32)}`);
const evaluator = privateKeyToAccount(`0x${"33".repeat(32)}`);
const DELIVERABLE = "YieldPilot completed scan_opportunities: 23.44% supply APY on Venus";

function storedJob(id: string, status: string, paymentId: string): StoredJob {
  return {
    id,
    paymentId,
    client: client.address,
    provider: provider.address,
    evaluator: evaluator.address,
    description: "hire YieldPilot",
    chainId: 56,
    tokenId: "1",
    agentName: "YieldPilot",
    budgetUsd: 2,
    expiredAt: "2099-01-01T00:00:00.000Z",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [
      { at: "2026-01-01T00:00:00.000Z", status: "Open", by: client.address },
      { at: "2026-01-01T00:00:00.000Z", status: "Funded", by: client.address, reason: "x402 settlement" },
    ],
  };
}

function seed(job: StoredJob) {
  store.jobs.set(job.id, clone(job));
  if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
}

function stubMcp(text: string) {
  return async (_input: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method: string };
    const payload =
      req.method === "tools/call"
        ? { jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text }] } }
        : { jsonrpc: "2.0", id: req.id, result: {} };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
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
  return { signature: await account.signMessage({ message }) };
}

// Wait until the gated transition write is queued, then report whether the caller
// already settled. A floating write lets the caller settle while the write waits.
async function waitForTransitionWrite(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 500 && gate.pending.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 1));
  }
  expect(gate.pending.length).toBeGreaterThan(0);
  return settled;
}

// Release every queued transition write until the caller settles.
async function releaseUntilSettled(promise: Promise<unknown>) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < 500 && !settled; i++) {
    for (const resolve of gate.pending.splice(0)) resolve();
    await new Promise((r) => setTimeout(r, 1));
  }
  expect(settled).toBe(true);
}

beforeEach(() => {
  store.jobs.clear();
  store.jobByPayment.clear();
  store.tasks.clear();
  store.taskByPayment.clear();
  gate.transition = "";
  for (const resolve of gate.pending.splice(0)) resolve();
  vi.unstubAllGlobals();
  scanner.fetchAgentDetail.mockReset();
  scanner.fetchAgentDetail.mockResolvedValue({
    mcp_server: "https://agent.example/mcp",
    a2a_endpoint: null,
  });
  receipts.getPaymentDurable.mockReset();
});

describe("delivery awaits the Submitted write before reporting progress", () => {
  it("persists Submitted before deliver resolves and reports the persisted state", async () => {
    const paymentId = "pay-persist-delivery";
    const job = storedJob("job-persist-delivery", "Funded", paymentId);
    seed(job);
    receipts.getPaymentDurable.mockResolvedValue({
      activated: true,
      agent: { chainId: 56, tokenId: "1", name: "YieldPilot" },
    });
    vi.stubGlobal("fetch", stubMcp(DELIVERABLE));

    gate.transition = "Submitted";
    const pending = deliver({ paymentId, tool: "scan_opportunities", args: {} });
    const settledWhileWriting = await waitForTransitionWrite(pending);
    // the durable write is still in flight, so the caller must not have returned
    expect(settledWhileWriting).toBe(false);

    await releaseUntilSettled(pending);
    const out = await pending;
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.status).toBe("Submitted");

    const persisted = store.jobs.get(job.id);
    expect(persisted?.status).toBe("Submitted");
    expect(persisted?.deliverable).toContain("scan_opportunities");
  });
});

describe("the jobs route awaits the transition write before responding", () => {
  it("submits: the response is the persisted Submitted job", async () => {
    const job = storedJob("job-persist-route-submit", "Funded", "pay-persist-route-submit");
    seed(job);
    const { signature } = await sign(provider, {
      jobId: job.id,
      action: "submit",
      address: provider.address,
      deliverable: DELIVERABLE,
    });

    gate.transition = "Submitted";
    const pending = post(job.id, {
      action: "submit",
      by: provider.address,
      deliverable: DELIVERABLE,
      signature,
    });
    const settledWhileWriting = await waitForTransitionWrite(pending);
    expect(settledWhileWriting).toBe(false);

    await releaseUntilSettled(pending);
    const res = await pending;
    const body = (await res.json()) as { success: boolean; job: Job };
    expect(res.status).toBe(200);
    expect(body.job.status).toBe("Submitted");
    expect(getJob(job.id)?.status).toBe("Submitted");

    const persisted = store.jobs.get(job.id);
    expect(persisted?.status).toBe("Submitted");
    expect(persisted?.deliverable).toBe(DELIVERABLE);
  });

  it("completes: the response is the persisted Completed job", async () => {
    const job = storedJob("job-persist-route-complete", "Submitted", "pay-persist-route-complete");
    seed(job);
    const { signature } = await sign(evaluator, {
      jobId: job.id,
      action: "complete",
      address: evaluator.address,
      reason: "approved",
    });

    gate.transition = "Completed";
    const pending = post(job.id, {
      action: "complete",
      by: evaluator.address,
      reason: "approved",
      signature,
    });
    const settledWhileWriting = await waitForTransitionWrite(pending);
    expect(settledWhileWriting).toBe(false);

    await releaseUntilSettled(pending);
    const res = await pending;
    const body = (await res.json()) as { success: boolean; job: Job };
    expect(res.status).toBe(200);
    expect(body.job.status).toBe("Completed");
    expect(body.job.attestation).toBe("approved");

    const persisted = store.jobs.get(job.id);
    expect(persisted?.status).toBe("Completed");
    expect(persisted?.attestation).toBe("approved");
  });
});
