// one plain state per hire on Ongoing: what waits on the buyer comes first, an expired
// hire never offers a run, a finished job keeps an open session revocable, and a JSON
// deliverable reads as fields
import { describe, expect, it } from "vitest";
import { escrowChip, escrowFlowIndex, escrowLifecycle, escrowRejectMove, hireItems, hireState, readableResult, type HireItem } from "../apps/web/src/lib/hire-state";
import type { ActiveHireSession, Erc8183Job, EscrowStatus, HireTask } from "../apps/web/src/lib/api";

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

function escrow(over: Partial<EscrowStatus> = {}): EscrowStatus {
  return {
    paymentId: "req_1",
    buyer: "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862",
    payTo: "0x6d5767ca6e48b7103f3e660a2ff78148d2ec6ab4",
    amount: "2000000000000000000",
    status: 0,
    fundedAt: 1791373327,
    verifiedAt: 0,
    windowEndsAt: null,
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

describe("escrow on a hire", () => {
  it("reads a held payment as held rather than paid out", () => {
    expect(hireState(item({ escrow: escrow() }))).toMatchObject({ label: "Paid, held in escrow", action: "run" });
    expect(
      hireState(item({ job: job("Completed"), escrow: escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 }) })),
    ).toMatchObject({ label: "Completed", note: expect.stringContaining("releases from escrow") });
  });

  it("offers the refund only while the escrow is still refundable", () => {
    expect(hireState(item({ live: false, escrow: escrow() }))).toMatchObject({
      label: "Ended unused",
      note: expect.stringContaining("take the refund"),
    });
    expect(hireState(item({ job: job("Expired"), escrow: escrow() }))).toMatchObject({
      note: expect.stringContaining("take the refund"),
    });
    expect(hireState(item({ live: false, escrow: escrow({ verifiedAt: 1791373545 }) }))).toMatchObject({
      label: "Ended unused",
      note: expect.stringContaining("not left the escrow"),
    });
  });

  it("says where the money is on a rejected job", () => {
    expect(hireState(item({ job: job("Rejected"), escrow: escrow() }))).toMatchObject({
      label: "Rejected",
      note: expect.stringContaining("not left the escrow"),
    });
    expect(hireState(item({ job: job("Rejected") }))).toEqual({ group: "finished", label: "Rejected" });
  });

  it("leaves a hire with no escrow exactly as it was", () => {
    expect(hireState(item())).toMatchObject({ label: "Paid, ready to run" });
    expect(hireState(item({ live: false }))).toEqual({ group: "finished", label: "Ended unused" });
    expect(hireState(item({ job: job("Completed") }))).toEqual({ group: "finished", label: "Completed" });
    expect(hireState(item({ job: job("Expired") }))).toEqual({ group: "finished", label: "Expired" });
  });
});

describe("escrow chip", () => {
  it("has no line for a hire with no escrow", () => {
    expect(escrowChip(null)).toBeNull();
    expect(escrowChip(undefined)).toBeNull();
  });

  it("follows the money through its states", () => {
    expect(escrowChip(escrow())).toEqual({ text: "Held in escrow, waiting on delivery", tone: "hold" });
    const verified = escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 });
    expect(escrowChip(verified, 1791375000 * 1000)).toEqual({ text: "Held in escrow, dispute window open", tone: "hold" });
    expect(escrowChip(verified, 1791378000 * 1000)).toEqual({ text: "Ready to release from escrow", tone: "ready" });
    expect(escrowChip(escrow({ status: 1, verifiedAt: 1791373545, windowEndsAt: 1791377145 }))).toEqual({
      text: "Released to the agent",
      tone: "done",
    });
    expect(escrowChip(escrow({ status: 2 }))).toEqual({ text: "Refunded to your wallet", tone: "done" });
  });

  it("treats an unknown window as still open", () => {
    expect(escrowChip(escrow({ verifiedAt: 1791373545, windowEndsAt: null }), Date.now())).toEqual({
      text: "Held in escrow, dispute window open",
      tone: "hold",
    });
  });
});

describe("escrow reject move", () => {
  it("needs no on-chain move without an escrow or once the money is with the buyer", () => {
    expect(escrowRejectMove(null)).toEqual({ kind: "plain" });
    expect(escrowRejectMove(undefined)).toEqual({ kind: "plain" });
    expect(escrowRejectMove(escrow({ status: 2 }))).toEqual({ kind: "plain" });
  });

  it("takes the refund back before any verified delivery", () => {
    expect(escrowRejectMove(escrow())).toEqual({ kind: "refund" });
  });

  it("disputes inside the window after a verified delivery", () => {
    const verified = escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 });
    expect(escrowRejectMove(verified, 1791375000 * 1000)).toEqual({ kind: "reject" });
    // an unknown window still goes to the contract, which enforces it anyway
    expect(escrowRejectMove(escrow({ verifiedAt: 1791373545, windowEndsAt: null }), Date.now())).toEqual({
      kind: "reject",
    });
  });

  it("refuses with the reason once the chain will not take the money back", () => {
    const verified = escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 });
    expect(escrowRejectMove(verified, 1791378000 * 1000)).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("dispute window has passed"),
    });
    expect(escrowRejectMove(escrow({ status: 1, verifiedAt: 1791373545, windowEndsAt: 1791377145 }))).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("already released"),
    });
  });
});

describe("escrow lifecycle spine", () => {
  it("holds before any verified delivery, with the refund as the only verb", () => {
    const spine = escrowLifecycle(escrow());
    expect(spine?.stage).toBe("held");
    expect(spine?.autoReleaseAt).toBeNull();
    expect(spine?.actions).toEqual(["refund"]);
    expect(spine?.label).toContain("waiting on delivery");
  });

  it("names the do-nothing date while the dispute window is open", () => {
    const spine = escrowLifecycle(escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 }), 1791375000 * 1000);
    expect(spine?.stage).toBe("verifiedWindow");
    expect(spine?.autoReleaseAt).toBe(1791377145 * 1000);
    expect(spine?.actions).toEqual(["release", "dispute"]);
    expect(spine?.label).toContain("dispute window open");
  });

  it("reads ready to release once the calendar moves, and closed after a move", () => {
    const ready = escrowLifecycle(escrow({ verifiedAt: 1791373545, windowEndsAt: 1791377145 }), 1791378000 * 1000);
    expect(ready?.label).toBe("Ready to release");
    expect(ready?.actions).toEqual(["release"]);
    expect(escrowLifecycle(escrow({ status: 1 }))?.stage).toBe("released");
    expect(escrowLifecycle(escrow({ status: 2 }))?.stage).toBe("refunded");
    expect(escrowLifecycle(null)).toBeNull();
  });
});

describe("the card's flow index", () => {
  it("walks the five stops as the escrow advances", () => {
    expect(escrowFlowIndex("held", null)).toBe(1);
    expect(escrowFlowIndex("verifiedWindow", 1791377145 * 1000, 1791375000 * 1000)).toBe(2);
    expect(escrowFlowIndex("verifiedWindow", 1791377145 * 1000, 1791378000 * 1000)).toBe(3);
    expect(escrowFlowIndex("released", null)).toBe(4);
  });
});
