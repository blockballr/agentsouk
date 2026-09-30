// one plain state per hire on Ongoing: what waits on the buyer comes first, an expired
// hire never offers a run, a finished job keeps an open session revocable, and a JSON
// deliverable reads as fields
import { describe, expect, it } from "vitest";
import { hireItems, hireState, readableResult, type HireItem } from "../apps/web/src/lib/hire-state";
import type { ActiveHireSession, Erc8183Job, HireTask } from "../apps/web/src/lib/api";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function session(over: Partial<ActiveHireSession> = {}): ActiveHireSession {
  return {
    paymentId: "req_1",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    client: "0xclient",
    spendCapUsd: 5,
    expiresAt: "2026-10-01T00:00:00.000Z",
    mode: "prod",
    createdAt: "2026-09-30T10:00:00.000Z",
    ...over,
  };
}

function task(over: Partial<HireTask> = {}): HireTask {
  return {
    id: "t1",
    paymentId: "req_1",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    status: "ready",
    attempts: 0,
    maxAttempts: 3,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:05:00.000Z",
    history: [],
    ...over,
  };
}

function job(status: Erc8183Job["status"]): Erc8183Job {
  return {
    id: "j1",
    client: "0xclient",
    provider: "0xagent",
    evaluator: "0xclient",
    description: "Hire",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    budgetUsd: 2,
    expiredAt: "2026-10-01T00:00:00.000Z",
    status,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:05:00.000Z",
  };
}

function item(over: Partial<HireItem> = {}): HireItem {
  return {
    key: "req_1",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    session: session(),
    task: null,
    job: null,
    live: true,
    at: "2026-09-30T10:00:00.000Z",
    ...over,
  };
}

describe("hire state", () => {
  it("puts a submitted job first, waiting on the buyer", () => {
    const s = hireState(item({ job: job("Submitted"), task: task({ status: "delivered" }) }));
    expect(s).toMatchObject({ group: "needs", action: "complete" });
  });

  it("offers a run on a live paid session with nothing run yet", () => {
    expect(hireState(item())).toMatchObject({ group: "needs", action: "run", label: "Paid, ready to run" });
  });

  it("never offers a run once the session has ended", () => {
    expect(hireState(item({ live: false }))).toMatchObject({ group: "finished", label: "Ended unused" });
  });

  it("offers a retry while attempts remain, even after the session ends", () => {
    expect(hireState(item({ task: task({ status: "failed", attempts: 1 }) }))).toMatchObject({ action: "retry" });
    expect(hireState(item({ live: false, task: task({ status: "failed", attempts: 1 }) }))).toMatchObject({ action: "retry" });
    expect(hireState(item({ task: task({ status: "failed", attempts: 3 }) }))).toMatchObject({ group: "finished" });
  });

  it("reads a running task as in progress and a completed job as finished", () => {
    expect(hireState(item({ task: task({ status: "running" }) })).group).toBe("progress");
    expect(hireState(item({ job: job("Completed") }))).toMatchObject({ group: "finished", label: "Completed" });
  });
});

describe("hire items", () => {
  it("keeps one entry per payment, ends a hire on expiry alone, newest first", () => {
    const items = hireItems(
      {
        sessions: [
          { session: session({ paymentId: "a", createdAt: "2026-09-30T09:00:00.000Z" }), task: null, job: null },
          { session: session({ paymentId: "b", expiresAt: "2026-09-30T11:00:00.000Z" }), task: null, job: null },
          { session: session({ paymentId: "c", createdAt: "2026-09-30T11:30:00.000Z" }), task: null, job: job("Completed") },
        ],
        recentTasks: [
          { task: task({ paymentId: "a" }), session: null, job: null },
          { task: task({ paymentId: "d", updatedAt: "2026-09-29T00:00:00.000Z" }), session: null, job: null },
        ],
      },
      NOW,
    );
    expect(items.map((i) => [i.key, i.live])).toEqual([
      ["c", true],
      ["b", false],
      ["a", true],
      ["d", false],
    ]);
  });
});

describe("readable result", () => {
  it("turns a JSON object into labelled fields, unwrapping a data part", () => {
    const r = readableResult(JSON.stringify({ kind: "data", data: { healthFactor: 1.23, state: "healthy", ok: true } }));
    expect(r).toEqual({
      kind: "fields",
      fields: [
        ["Health factor", "1.23"],
        ["State", "healthy"],
        ["Ok", "yes"],
      ],
      more: 0,
    });
  });

  it("leaves plain text as text", () => {
    expect(readableResult("Health factor is 1.23")).toEqual({ kind: "text", text: "Health factor is 1.23" });
  });
});
