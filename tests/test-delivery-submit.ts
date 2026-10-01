// A delivery over A2A for a hire on the marketplace's own agent must advance the
// ERC-8183 job to Submitted and persist it. A self hire has the same wallet as
// client and provider, which is the shape the marketplace's own agent produces.
// The durable store is cloned on every write and read, as postgres is, so a
// mutation that is never written back is visible here as a lost submit.
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
  tokenId: string;
  agentName: string;
  updatedAt: string;
  taskId?: string;
  deliverable?: string;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// The fake store stands in for postgres: every write and every read goes through
// a JSON clone, so the caller never shares an object with what is stored.
const store = vi.hoisted(() => ({
  jobs: new Map<string, StoredJob>(),
  jobByPayment: new Map<string, string>(),
  tasks: new Map<string, StoredTask>(),
  taskByPayment: new Map<string, string>(),
  // When false, the indexed by-payment read returns nothing even though the row is
  // still listed: the production shape where the durable job is held but the
  // delivery's payment lookup cannot see it.
  indexedPaymentRead: true,
}));

vi.mock("../src/lib/durable-store", () => ({
  durableMode: () => "memory",
  saveJob: async (job: StoredJob) => {
    store.jobs.set(job.id, clone(job));
    if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
  },
  loadJob: async (id: string) => {
    const job = store.jobs.get(id);
    return job ? clone(job) : undefined;
  },
  loadJobByPayment: async (paymentId: string) => {
    if (!store.indexedPaymentRead) return undefined;
    const id = store.jobByPayment.get(paymentId);
    const job = id ? store.jobs.get(id) : undefined;
    return job ? clone(job) : undefined;
  },
  loadJobs: async () => [...store.jobs.values()].map(clone),
  loadJobsByClient: async (client: string) =>
    [...store.jobs.values()]
      .filter((j) => j.client.toLowerCase() === client.toLowerCase())
      .map(clone),
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

const scanner = vi.hoisted(() => ({ fetchAgentDetail: vi.fn() }));
vi.mock("@/lib/scanner", () => scanner);
vi.mock("@/lib/endpoint", () => ({ privateEndpointReason: () => null }));

const receipts = vi.hoisted(() => ({ getPaymentDurable: vi.fn() }));
vi.mock("../src/lib/receipts-store", () => receipts);

import { SECRET_REPLY_REFUSAL, deliver, sessionEnded } from "../src/lib/delivery";
import { submitJobAsync } from "../src/lib/jobs";

const WALLET = "0x84fedaBd1b83443aD86796C15619494878B64180";

function receipt(expiresAt: string | undefined) {
  return {
    activated: true,
    agent: { chainId: 97, tokenId: "2504", name: "Souk Health Guard" },
    session: { spendCapUsd: 5, expiresAt },
  };
}
const DELIVERABLE =
  "Health factor 1.6 for collateral 1000 USD at a liquidation threshold of 0.8 and debt 500 USD. Liquidation capacity is 800 USD.";

// The house agent answers message/send with a task envelope: the agent's words in
// status.message.parts and the payload in artifacts. A GET returns its card.
function stubHouseAgent(reply = DELIVERABLE) {
  return async (url: string | URL | Request, init?: { body?: unknown }) => {
    const href = typeof url === "string" ? url : url.toString();
    if (init?.body === undefined) {
      return new Response(
        JSON.stringify({
          name: "Souk Health Guard",
          url: "https://house.example/a2a",
          supportedInterfaces: [{ url: "https://house.example/a2a" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    expect(href).toContain("/a2a");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          task: {
            id: "task-1",
            kind: "task",
            status: {
              state: "completed",
              message: {
                role: "agent",
                messageId: "msg-1",
                parts: [{ kind: "text", text: reply }],
              },
            },
            artifacts: [{ parts: [{ kind: "data", data: { healthFactor: 1.6 } }] }],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function fundedSelfHire(paymentId: string): StoredJob {
  return {
    id: `job-${paymentId}`,
    paymentId,
    client: WALLET,
    provider: WALLET,
    evaluator: WALLET,
    description: "Hire Souk Health Guard",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    updatedAt: "2026-09-27T11:44:00.405Z",
    status: "Funded",
    history: [
      { at: "2026-09-27T11:44:00.405Z", status: "Open", by: WALLET },
      { at: "2026-09-27T11:44:00.405Z", status: "Funded", by: WALLET, reason: "x402 settlement" },
    ],
  };
}

function seedJob(job: StoredJob) {
  store.jobs.set(job.id, clone(job));
  if (job.paymentId) store.jobByPayment.set(job.paymentId, job.id);
}

beforeEach(() => {
  store.jobs.clear();
  store.jobByPayment.clear();
  store.tasks.clear();
  store.taskByPayment.clear();
  store.indexedPaymentRead = true;
  vi.unstubAllGlobals();
  scanner.fetchAgentDetail.mockReset();
  scanner.fetchAgentDetail.mockResolvedValue({
    mcp_server: null,
    a2a_endpoint: "https://house.example/.well-known/agent-card.json",
  });
  receipts.getPaymentDurable.mockReset();
  receipts.getPaymentDurable.mockResolvedValue(receipt("2099-01-01T00:00:00.000Z"));
  vi.stubGlobal("fetch", stubHouseAgent());
});

describe("a reply that asks for a wallet secret", () => {
  it("is a failed delivery, leaves the job unsubmitted and tells the buyer why", async () => {
    const paymentId = "req_key_request";
    seedJob(fundedSelfHire(paymentId));
    vi.stubGlobal("fetch", stubHouseAgent("To continue, send your private key as metadata (accountPrivateKey)."));

    const out = await deliver({ paymentId, task: "Check my position." });

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("a request for a private key was delivered");
    expect(out.error).toBe(SECRET_REPLY_REFUSAL);
    expect(store.jobs.get(`job-${paymentId}`)?.status).toBe("Funded");
    const task = [...store.tasks.values()].find((t) => t.paymentId === paymentId);
    expect(task?.status).toBe("failed");
  });

  it("still delivers an answer that only promises never to ask for one", async () => {
    const paymentId = "req_key_promise";
    seedJob(fundedSelfHire(paymentId));
    vi.stubGlobal("fetch", stubHouseAgent("Health factor 1.6. This agent never asks for a private key."));

    const out = await deliver({ paymentId, task: "Check my position." });

    expect(out.ok).toBe(true);
    expect(store.jobs.get(`job-${paymentId}`)?.status).toBe("Submitted");
  });
});

describe("a delivery stops when the session has ended", () => {
  it("refuses a receipt past its expiry without calling the agent", async () => {
    const paymentId = "req_session_over";
    seedJob(fundedSelfHire(paymentId));
    receipts.getPaymentDurable.mockResolvedValue(receipt("2026-09-30T12:00:00.000Z"));
    const calls = vi.fn(stubHouseAgent());
    vi.stubGlobal("fetch", calls);

    const out = await deliver({ paymentId, task: "Compute the health factor for collateral 1000 and debt 500." });

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("an ended session ran a task");
    expect(out.error).toBe("This session ended on 2026-09-30 12:00 UTC. Hire the agent again to run more tasks.");
    expect(calls).not.toHaveBeenCalled();
    expect(scanner.fetchAgentDetail).not.toHaveBeenCalled();
    expect(store.jobs.get(`job-${paymentId}`)?.status).toBe("Funded");
    expect(store.tasks.size).toBe(0);
  });

  it("refuses a receipt whose expiry is missing or unreadable", async () => {
    for (const expiresAt of [undefined, "", "soon"]) {
      receipts.getPaymentDurable.mockResolvedValue(receipt(expiresAt));
      const out = await deliver({ paymentId: "req_no_expiry", task: "anything" });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("a receipt with no readable expiry ran a task");
      expect(out.error).toBe("This session ended. Hire the agent again to run more tasks.");
    }
  });

  it("still replays a failed call that was paid for, which is the one thing that outlives the session", async () => {
    const paymentId = "req_retry_after_end";
    seedJob(fundedSelfHire(paymentId));
    receipts.getPaymentDurable.mockResolvedValue(receipt("2026-09-30T12:00:00.000Z"));

    const out = await deliver({
      paymentId,
      taskId: "task-being-retried",
      task: "Compute the health factor for collateral 1000 USD and debt 500 USD.",
      input: { collateral: 1000, debt: 500 },
    });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.text).toContain("Health factor 1.6");
    expect(out.taskId).toBe("task-being-retried");
  });

  it("treats the expiry instant itself as ended", () => {
    const at = "2026-10-01T10:00:00.000Z";
    const t = new Date(at).getTime();
    expect(sessionEnded(at, t - 1)).toBe(false);
    expect(sessionEnded(at, t)).toBe(true);
    expect(sessionEnded(at, t + 1)).toBe(true);
  });
});

describe("a delivery advances a self hire opened by settle", () => {
  it("submits the Funded job the store holds, even when the payment-indexed read misses it", async () => {
    const paymentId = "req_0xdc86a0d95846358c";
    const job = fundedSelfHire(paymentId);
    seedJob(job);
    // The production shape: the durable store holds the Funded job, listed with its
    // paymentId, but the payment-indexed read does not return it. The delivery must
    // still find the job it is paid to advance rather than report none.
    store.indexedPaymentRead = false;

    const out = await deliver({
      paymentId,
      task: "Compute the health factor for collateral 1000 USD and debt 500 USD at a liquidation threshold of 0.8.",
      input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 },
    });

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error(out.error);
    expect(out.jobAdvance?.advanced).toBe(true);
    expect(out.jobAdvance?.status).toBe("Submitted");

    // the durable record, not the object the delivery held, must show Submitted
    const persisted = store.jobs.get(job.id);
    expect(persisted?.status).toBe("Submitted");
    expect(persisted?.taskId).toBe(out.taskId);
    expect(persisted?.deliverable).toContain("Health factor 1.6");
    expect(persisted?.history.map((h) => h.status)).toContain("Submitted");
    expect(
      persisted?.history.some((h) => h.status === "Submitted" && h.by === "marketplace"),
    ).toBe(true);
  });
});

describe("the durable submit keeps the state machine rules", () => {
  it("refuses a caller that is neither the provider nor the marketplace", async () => {
    const paymentId = "req_rule_provider";
    const job = fundedSelfHire(paymentId);
    seedJob(job);

    const out = await submitJobAsync({
      jobId: job.id,
      provider: "0x000000000000000000000000000000000000dEaD",
      deliverable: "stolen",
    });

    expect(out).toBeUndefined();
    expect(store.jobs.get(job.id)?.status).toBe("Funded");
    expect(store.jobs.get(job.id)?.deliverable).toBeUndefined();
  });

  it("leaves an already Submitted job and its deliverable untouched", async () => {
    const paymentId = "req_rule_submitted";
    const job = fundedSelfHire(paymentId);
    job.status = "Submitted";
    job.deliverable = "the original deliverable";
    job.history.push({ at: "2026-09-27T11:45:00.000Z", status: "Submitted", by: WALLET });
    seedJob(job);

    const out = await submitJobAsync({
      jobId: job.id,
      provider: "marketplace",
      deliverable: "a second deliverable",
    });

    expect(out?.status).toBe("Submitted");
    expect(store.jobs.get(job.id)?.deliverable).toBe("the original deliverable");
    expect(
      store.jobs.get(job.id)?.history.filter((h) => h.status === "Submitted"),
    ).toHaveLength(1);
  });
});
