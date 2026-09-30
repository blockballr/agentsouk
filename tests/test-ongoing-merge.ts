// The Ongoing list must be complete no matter which instance answers, so the
// page merges the instance bundle with the wallet's durable hires. These pin the
// rules: the bundle wins a collision, a wallet-only hire still appears, the list
// runs newest first, and an expired hire leaves the live list while an undated
// hire stays.
import { describe, expect, it } from "vitest";
import { mergeSessions, stabiliseSessions } from "../apps/web/src/lib/ongoing-merge";
import type {
  ActiveHireSession,
  Erc8183Job,
  HireTask,
  WalletHire,
} from "../apps/web/src/lib/api";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

function session(over: Partial<ActiveHireSession> = {}): ActiveHireSession {
  return {
    paymentId: over.paymentId ?? "req_default",
    chainId: over.chainId ?? 97,
    tokenId: over.tokenId ?? "1",
    agentName: over.agentName ?? "Agent",
    client: over.client ?? "0xclient",
    spendCapUsd: over.spendCapUsd ?? 5,
    expiresAt: over.expiresAt ?? "2026-09-28T00:00:00.000Z",
    mode: over.mode ?? "prod",
    createdAt: over.createdAt ?? "2026-09-26T00:00:00.000Z",
  };
}

function task(paymentId: string): HireTask {
  return {
    id: `task-${paymentId}`,
    paymentId,
    chainId: 97,
    tokenId: "1",
    agentName: "Agent",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    history: [],
  };
}

function job(paymentId: string): Erc8183Job {
  return {
    id: `job-${paymentId}`,
    client: "0xclient",
    provider: "0xprovider",
    evaluator: "0xevaluator",
    description: "Hire Agent",
    chainId: 97,
    tokenId: "1",
    agentName: "Agent",
    paymentId,
    budgetUsd: 2,
    expiredAt: "2026-09-28T00:00:00.000Z",
    status: "Funded",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

function hire(over: Partial<WalletHire> & { paymentId: string }): WalletHire {
  return {
    paymentId: over.paymentId,
    chainId: over.chainId ?? 97,
    tokenId: over.tokenId ?? "1",
    agentName: over.agentName ?? "Agent",
    client: over.client ?? "0xclient",
    mode: over.mode ?? "prod",
    spendCapUsd: over.spendCapUsd ?? 5,
    createdAt: over.createdAt ?? "2026-09-26T00:00:00.000Z",
    expiresAt: over.expiresAt,
  };
}

describe("mergeSessions", () => {
  it("shows a hire the instance bundle never mentions, with no task or job", () => {
    const merged = mergeSessions([], [hire({ paymentId: "req_only_wallet" })], NOW);
    expect(merged.map((entry) => entry.session.paymentId)).toEqual(["req_only_wallet"]);
    expect(merged[0].task).toBeNull();
    expect(merged[0].job).toBeNull();
  });

  it("keeps the bundle entry when both sources carry the payment", () => {
    const bundle = [
      {
        session: session({ paymentId: "req_both" }),
        task: task("req_both"),
        job: job("req_both"),
      },
    ];
    const merged = mergeSessions(
      bundle,
      [hire({ paymentId: "req_both", agentName: "Other name" })],
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].task?.id).toBe("task-req_both");
    expect(merged[0].job?.id).toBe("job-req_both");
    expect(merged[0].session.agentName).toBe("Agent");
  });

  it("orders the live list newest first across both sources", () => {
    const bundle = [
      {
        session: session({ paymentId: "req_old", createdAt: "2026-09-24T00:00:00.000Z" }),
        task: null,
        job: null,
      },
    ];
    const merged = mergeSessions(
      bundle,
      [
        hire({ paymentId: "req_new", createdAt: "2026-09-27T00:00:00.000Z" }),
        hire({ paymentId: "req_mid", createdAt: "2026-09-26T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(merged.map((entry) => entry.session.paymentId)).toEqual([
      "req_new",
      "req_mid",
      "req_old",
    ]);
  });

  it("keeps an undated hire and drops an expired one from the live list", () => {
    const merged = mergeSessions(
      [],
      [
        hire({ paymentId: "req_no_expiry", expiresAt: undefined }),
        hire({ paymentId: "req_live", expiresAt: "2026-09-28T00:00:00.000Z" }),
        hire({ paymentId: "req_expired", expiresAt: "2026-09-26T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(merged.map((entry) => entry.session.paymentId).sort()).toEqual([
      "req_live",
      "req_no_expiry",
    ]);
  });

  it("stays empty when neither source has a hire", () => {
    expect(mergeSessions([], [], NOW)).toEqual([]);
  });
});

// polls can land on instances that disagree about a hire, and swapping the card
// between them is what made the output box and buttons appear and disappear
describe("stabiliseSessions", () => {
  const entry = (paymentId: string, t: HireTask | null, j: Erc8183Job | null) => ({
    session: session({ paymentId }),
    task: t,
    job: j,
  });
  const later = "2026-09-27T09:00:00.000Z";

  it("passes the first poll through", () => {
    const first = [entry("req_a", task("req_a"), null)];
    expect(stabiliseSessions(null, first)).toBe(first);
  });

  it("keeps the last known task and job when a poll comes back without them", () => {
    const before = [entry("req_a", task("req_a"), job("req_a"))];
    const [out] = stabiliseSessions(before, [entry("req_a", null, null)]);
    expect(out.task?.id).toBe("task-req_a");
    expect(out.job?.status).toBe("Funded");
  });

  it("never lets an older copy replace a newer one", () => {
    const done = { ...job("req_a"), status: "Completed" as const, updatedAt: later };
    const [out] = stabiliseSessions([entry("req_a", null, done)], [entry("req_a", null, job("req_a"))]);
    expect(out.job?.status).toBe("Completed");
  });

  it("lets a newer update through", () => {
    const submitted = { ...job("req_a"), status: "Submitted" as const, updatedAt: later };
    const delivered = { ...task("req_a"), status: "delivered" as const, result: "hf 1.6", updatedAt: later };
    const [out] = stabiliseSessions([entry("req_a", task("req_a"), job("req_a"))], [entry("req_a", delivered, submitted)]);
    expect(out.job?.status).toBe("Submitted");
    expect(out.task?.result).toBe("hf 1.6");
  });

  it("drops a session the next poll no longer lists, so a revoke leaves at once", () => {
    const out = stabiliseSessions([entry("req_a", task("req_a"), null), entry("req_b", null, null)], [entry("req_b", null, null)]);
    expect(out.map((e) => e.session.paymentId)).toEqual(["req_b"]);
  });
});
