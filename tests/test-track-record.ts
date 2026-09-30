// The track record is what the marketplace observed, so it must never count the
// verifier's own probes, the team's wallets, or an owner hiring itself as buyer
// activity, and it must say when there was nothing to observe from.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summariseTrackRecord } from "../src/lib/track-record";
import type { Job } from "../src/lib/jobs";
import type { HireTask } from "../src/lib/tasks";

const OWNER = "0x1111111111111111111111111111111111111111";
const AGENT_WALLET = "0x2222222222222222222222222222222222222222";
const BUYER = "0x3333333333333333333333333333333333333333";
const TEAM_BUYER = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";

function job(paymentId: string, client: string, status: Job["status"], createdAt = "2026-09-30T10:00:00.000Z"): Job {
  return {
    id: `job-${paymentId}`,
    client,
    provider: AGENT_WALLET,
    evaluator: "0x0",
    description: "",
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    paymentId,
    budgetUsd: 2,
    expiredAt: "2026-10-01T00:00:00.000Z",
    status,
    createdAt,
    updatedAt: createdAt,
    history: [],
  };
}

function task(paymentId: string, status: HireTask["status"], grade?: "good" | "partial" | "poor"): HireTask {
  return {
    id: `task-${paymentId}-${status}`,
    paymentId,
    chainId: 97,
    tokenId: "2504",
    agentName: "Souk Health Guard",
    status,
    ...(grade ? { quality: { grade, score: 1, reason: "" } } : {}),
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-09-30T10:00:00.000Z",
    updatedAt: "2026-09-30T10:05:00.000Z",
    history: [],
  };
}

describe("track record from observed jobs and tasks", () => {
  it("counts only buyer hires and keeps the verifier's probes apart", () => {
    const jobs = [
      job("pay_a", BUYER, "Completed", "2026-09-30T10:00:00.000Z"),
      job("pay_b", BUYER, "Funded", "2026-10-01T09:00:00.000Z"),
      job("verify_1", TEAM_BUYER, "Funded"),
      job("pay_team", TEAM_BUYER, "Completed"),
      job("pay_self", OWNER, "Completed"),
      job("pay_wallet", AGENT_WALLET, "Completed"),
      job("pay_open", BUYER, "Open"),
    ];
    const tasks = [
      task("pay_a", "delivered", "good"),
      task("pay_b", "failed"),
      task("verify_1", "delivered"),
      task("pay_team", "delivered", "good"),
      task("pay_self", "delivered", "good"),
    ];
    const record = summariseTrackRecord(97, "2504", jobs, tasks, OWNER);
    expect(record.hires).toBe(2);
    expect(record.completed).toBe(1);
    expect(record.deliveries).toEqual({ delivered: 1, failed: 1, gated: 0 });
    expect(record.successRate).toBe(0.5);
    expect(record.grades).toEqual({ good: 1, partial: 0, poor: 0 });
    expect(record.probes).toMatchObject({ delivered: 1, failed: 0, gated: 0 });
    expect(record.firstHireAt).toBe("2026-09-30T10:00:00.000Z");
    expect(record.lastHireAt).toBe("2026-10-01T09:00:00.000Z");
  });

  it("reports no success rate rather than zero when nothing was attempted", () => {
    const record = summariseTrackRecord(97, "2504", [], [], OWNER);
    expect(record.hires).toBe(0);
    expect(record.successRate).toBeNull();
    expect(record.firstHireAt).toBeNull();
  });

  it("ignores tasks still in flight", () => {
    const record = summariseTrackRecord(97, "2504", [job("pay_a", BUYER, "Funded")], [task("pay_a", "running")], OWNER);
    expect(record.deliveries).toEqual({ delivered: 0, failed: 0, gated: 0 });
  });
});
