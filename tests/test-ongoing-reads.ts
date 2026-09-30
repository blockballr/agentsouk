// The Ongoing page reads one wallet's tasks by its own payments. Before this it
// read the newest 200 tasks of every wallet, so the verifier's sweeps could push
// a buyer's task out of view while the session still showed.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({ rows: [] as unknown[], saved: 0 }));

vi.mock("../src/lib/durable-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/durable-store")>();
  return {
    ...actual,
    loadHireTasksByPayments: vi.fn(async (ids: string[]) =>
      (store.rows as { paymentId: string }[]).filter((r) => ids.includes(r.paymentId)),
    ),
    saveHireTask: vi.fn(async () => {
      store.saved += 1;
    }),
  };
});

import { listTasksForPayments } from "../src/lib/tasks";

function row(id: string, paymentId: string, updatedAt: string, status = "delivered") {
  return {
    id,
    paymentId,
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    status,
    attempts: 1,
    maxAttempts: 3,
    createdAt: updatedAt,
    updatedAt,
    history: [],
  };
}

describe("tasks read by payment", () => {
  it("returns only the asked payments, newest first, from the durable store", async () => {
    store.rows = [
      row("t-mine", "pay_mine", "2026-09-30T10:00:00.000Z"),
      row("t-sweep", "verify_1", "2026-09-30T11:00:00.000Z"),
      row("t-mine-2", "pay_mine_2", "2026-09-30T12:00:00.000Z"),
    ];
    const out = await listTasksForPayments(["pay_mine", "pay_mine_2"]);
    expect(out.map((t) => t.id)).toEqual(["t-mine-2", "t-mine"]);
  });

  it("keeps a newer copy this instance holds and never writes a read back", async () => {
    store.saved = 0;
    store.rows = [row("t-held", "pay_held", "2026-09-30T08:00:00.000Z", "running")];
    await listTasksForPayments(["pay_held"]);
    store.rows = [row("t-held", "pay_held", "2026-09-30T07:00:00.000Z", "ready")];
    const [held] = await listTasksForPayments(["pay_held"]);
    expect(held.status).toBe("running");
    expect(store.saved).toBe(0);
  });

  it("returns nothing for a wallet with no payments", async () => {
    expect(await listTasksForPayments([])).toEqual([]);
  });
});
