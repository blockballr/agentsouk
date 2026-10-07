// A delivery must advance the ERC-8183 job to Submitted even when the settle that
// opened the job ran on another instance. The durable store is faked across freshly
// imported delivery modules, so the in-memory job map is empty while the store
// holds the job, which is the exact split the defect produced in production.
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

// The fake durable store stands in for postgres and outlives each fresh module
// instance, so a job written by one "instance" is still readable by the next.
const store = vi.hoisted(() => ({
  jobs: new Map<string, StoredJob>(),
  jobByPayment: new Map<string, string>(),
  tasks: new Map<string, StoredTask>(),
  taskByPayment: new Map<string, string>(),
}));

vi.mock("../src/lib/durable-store", () => ({
  durableMode: () => "memory",
  saveJob: async (job: StoredJob) => {
    store.jobs.set(job.id, job);
    if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
  },
  loadJob: async (id: string) => store.jobs.get(id),
  loadJobByPayment: async (paymentId: string) => {
    const id = store.jobByPayment.get(paymentId);
    return id ? store.jobs.get(id) : undefined;
  },
  loadJobs: async () => [...store.jobs.values()],
  loadJobsByClient: async (client: string) =>
    [...store.jobs.values()].filter((j) => j.client.toLowerCase() === client.toLowerCase()),
  // delivery.ts reaches the task store through the same durable module
  saveHireTask: async (task: StoredTask) => {
    store.tasks.set(task.id, task);
    store.taskByPayment.set(task.paymentId, task.id);
  },
  loadHireTask: async (id: string) => store.tasks.get(id),
  loadHireTaskByPayment: async (paymentId: string) => {
    const id = store.taskByPayment.get(paymentId);
    return id ? store.tasks.get(id) : undefined;
  },
  loadHireTasks: async () => [...store.tasks.values()],
  insertHireTaskIfAbsent: async (task: StoredTask) => {
    if (store.taskByPayment.has(task.paymentId)) return undefined;
    store.tasks.set(task.id, task);
    store.taskByPayment.set(task.paymentId, task.id);
    return task;
  },
}));

const scanner = vi.hoisted(() => ({ fetchAgentDetail: vi.fn() }));
vi.mock("@/lib/scanner", () => scanner);
vi.mock("@/lib/endpoint", () => ({ privateEndpointReason: () => null }));

const receipts = vi.hoisted(() => ({ getPaymentDurable: vi.fn() }));
vi.mock("../src/lib/receipts-store", () => receipts);

const CLIENT = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const EVALUATOR = "0x3333333333333333333333333333333333333333";
const DELIVERABLE = "YieldPilot completed scan_opportunities: 23.44% supply APY on Venus";

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

// A cold instance: fresh in-memory maps in jobs and tasks, the durable store warm.
async function setup() {
  vi.resetModules();
  const jobs = await import("../src/lib/jobs");
  const delivery = await import("../src/lib/delivery");
  receipts.getPaymentDurable.mockResolvedValue({
    activated: true,
    agent: { chainId: 56, tokenId: "1", name: "YieldPilot" },
    session: { spendCapUsd: 5, expiresAt: "2099-01-01T00:00:00.000Z" },
  });
  vi.stubGlobal("fetch", stubMcp(DELIVERABLE));
  return { jobs, delivery };
}

function storedJob(paymentId: string, status: string): StoredJob {
  return {
    id: `job-${paymentId}`,
    paymentId,
    client: CLIENT,
    provider: PROVIDER,
    evaluator: EVALUATOR,
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
      { at: "2026-01-01T00:00:00.000Z", status: "Open", by: CLIENT },
      { at: "2026-01-01T00:00:00.000Z", status: "Funded", by: CLIENT, reason: "x402 settlement" },
    ],
  };
}

function seedJob(job: StoredJob) {
  store.jobs.set(job.id, job);
  if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
}

beforeEach(() => {
  store.jobs.clear();
  store.jobByPayment.clear();
  store.tasks.clear();
  store.taskByPayment.clear();
  vi.unstubAllGlobals();
  scanner.fetchAgentDetail.mockReset();
  scanner.fetchAgentDetail.mockResolvedValue({
    mcp_server: "https://agent.example/mcp",
    a2a_endpoint: null,
  });
  receipts.getPaymentDurable.mockReset();
});

describe("delivery advances a job it did not create", () => {
  // the cold module re-import this test performs runs long against the 5s default
  // when four workers share the CPU in a full run, though it is well under alone
  it("finds a Funded job in the durable store and submits it", async () => {
    const paymentId = "pay-elsewhere";
    const job = storedJob(paymentId, "Funded");
    seedJob(job);

    const { jobs, delivery } = await setup();
    // the split the defect produced: the in-memory map cannot see the job
    expect(jobs.getJob(job.id)).toBeUndefined();
    expect(jobs.getJobByPayment(paymentId)).toBeUndefined();

    const out = await delivery.deliver({ paymentId, tool: "scan_opportunities", args: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.advanced).toBe(true);
    expect(out.jobAdvance?.jobId).toBe(job.id);
    expect(out.jobAdvance?.status).toBe("Submitted");

    const stored = store.jobs.get(job.id);
    expect(stored?.status).toBe("Submitted");
    expect(stored?.deliverable).toContain("scan_opportunities");
    expect(stored?.history.map((h) => h.status)).toContain("Submitted");
  }, 15000);
});

describe("an already advanced job is not advanced twice", () => {
  it("leaves a Submitted job and its deliverable untouched", async () => {
    const paymentId = "pay-submitted";
    const job = storedJob(paymentId, "Submitted");
    job.deliverable = "the original deliverable";
    job.history.push({ at: "2026-01-02T00:00:00.000Z", status: "Submitted", by: PROVIDER });
    seedJob(job);

    const { delivery } = await setup();
    const out = await delivery.deliver({ paymentId, tool: "scan_opportunities", args: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.advanced).toBe(false);
    expect(out.jobAdvance?.status).toBe("Submitted");

    expect(job.status).toBe("Submitted");
    expect(job.deliverable).toBe("the original deliverable");
    expect(job.history.filter((h) => h.status === "Submitted")).toHaveLength(1);
  });

  it("leaves a Completed job and its attestation untouched", async () => {
    const paymentId = "pay-completed";
    const job = storedJob(paymentId, "Completed");
    job.deliverable = "the graded deliverable";
    job.attestation = "approved";
    job.history.push({ at: "2026-01-02T00:00:00.000Z", status: "Submitted", by: PROVIDER });
    job.history.push({ at: "2026-01-03T00:00:00.000Z", status: "Completed", by: EVALUATOR, reason: "approved" });
    seedJob(job);

    const { delivery } = await setup();
    const out = await delivery.deliver({ paymentId, tool: "scan_opportunities", args: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.advanced).toBe(false);
    expect(out.jobAdvance?.status).toBe("Completed");

    expect(job.status).toBe("Completed");
    expect(job.attestation).toBe("approved");
    expect(job.history.filter((h) => h.status === "Completed")).toHaveLength(1);
  });
});

describe("a delivery with no job is reported", () => {
  it("says no job exists instead of skipping silently", async () => {
    const paymentId = "pay-orphan";
    const { delivery } = await setup();

    const out = await delivery.deliver({ paymentId, tool: "scan_opportunities", args: {} });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.advanced).toBe(false);
    expect(out.jobAdvance?.jobId).toBeUndefined();
    expect(out.jobAdvance?.note).toMatch(/no ERC-8183 job exists/i);

    // the task itself still completed, which is why the old silence hid the defect
    const task = [...store.tasks.values()].find((t) => t.paymentId === paymentId);
    expect(task?.status).toBe("delivered");
  });
});
