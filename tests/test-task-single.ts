// One task per payment. The guard lives partly in per-process memory and partly
// in the durable store, so these tests share a fake durable store across two
// freshly imported task modules to stand in for two serverless instances.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  process.env.RECEIPTS_STORE = "memory";
});

vi.mock("server-only", () => ({}));

interface StoredTask {
  id: string;
  paymentId: string;
  status: string;
  attempts: number;
  updatedAt: string;
  [key: string]: unknown;
}

const store = vi.hoisted(() => ({
  tasks: new Map<string, StoredTask>(),
  byPayment: new Map<string, string>(),
}));

vi.mock("../src/lib/durable-store", () => ({
  durableMode: () => "memory",
  saveHireTask: async (task: StoredTask) => {
    store.tasks.set(task.id, task);
    store.byPayment.set(task.paymentId, task.id);
  },
  loadHireTask: async (id: string) => store.tasks.get(id),
  loadHireTaskByPayment: async (paymentId: string) => {
    const id = store.byPayment.get(paymentId);
    return id ? store.tasks.get(id) : undefined;
  },
  loadHireTasks: async () => [...store.tasks.values()],
  // stand-in for the unique index on payment_id: the first insert wins, later
  // inserts for the same payment are refused and the caller adopts the winner
  insertHireTaskIfAbsent: async (task: StoredTask) => {
    if (store.byPayment.has(task.paymentId)) return undefined;
    store.tasks.set(task.id, task);
    store.byPayment.set(task.paymentId, task.id);
    return task;
  },
}));

// A cold instance: fresh in-memory maps, the durable store still warm.
async function instance() {
  vi.resetModules();
  return import("../src/lib/tasks");
}

function seed(paymentId: string) {
  return {
    paymentId,
    chainId: 56,
    tokenId: "42",
    agentName: "Local Grid Bot",
  };
}

function storedTask(
  id: string,
  paymentId: string,
  status: string,
): StoredTask {
  return {
    id,
    paymentId,
    status,
    attempts: status === "ready" ? 0 : 1,
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  store.tasks.clear();
  store.byPayment.clear();
});

describe("one task per payment", () => {
  it("returns the same task id when the same payment is ensured twice", async () => {
    const tasks = await instance();
    const input = seed("pay-single");

    const first = await tasks.ensureTaskForPayment(input);
    const second = await tasks.ensureTaskForPayment(input);

    expect(second.id).toBe(first.id);
    expect(store.tasks.size).toBe(1);
  });

  it("adopts a task already in the durable store instead of creating one", async () => {
    const existing = storedTask("task-from-other-instance", "pay-durable", "running");
    store.tasks.set(existing.id, existing);
    store.byPayment.set(existing.paymentId, existing.id);

    const tasks = await instance();
    const adopted = await tasks.ensureTaskForPayment(seed("pay-durable"));

    expect(adopted.id).toBe("task-from-other-instance");
    expect(adopted.status).toBe("running");
    expect(store.tasks.size).toBe(1);
  });

  it("cannot create a ready ghost beside a progressed row", async () => {
    const progressed = storedTask("task-delivered", "pay-ghost", "delivered");
    store.tasks.set(progressed.id, progressed);
    store.byPayment.set(progressed.paymentId, progressed.id);

    const tasks = await instance();
    const task = await tasks.ensureTaskForPayment(seed("pay-ghost"));

    expect(task.id).toBe("task-delivered");
    expect(task.status).toBe("delivered");
    const rows = [...store.tasks.values()].filter((t) => t.paymentId === "pay-ghost");
    expect(rows).toHaveLength(1);
  });

  it("lets only one of two cold instances win a create race", async () => {
    const a = await instance();
    const b = await instance();
    const input = seed("pay-race");

    const [fromA, fromB] = await Promise.all([
      a.ensureTaskForPayment(input),
      b.ensureTaskForPayment(input),
    ]);

    expect(fromB.id).toBe(fromA.id);
    const rows = [...store.tasks.values()].filter((t) => t.paymentId === "pay-race");
    expect(rows).toHaveLength(1);
  });
});
