// A seller's open jobs: funded ones waiting for the work and delivered ones waiting for the buyer,
// soonest deadline first; finished, refunded and expired jobs stay off the list.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const now = Math.floor(Date.now() / 1000);
const provider = "0xb815e17d6138ae6c7d6961c86a44006da45b54ef";
const index = vi.hoisted(() => ({ jobsForProviders: vi.fn() }));
vi.mock("@/lib/job-index", () => index);
vi.mock("@/lib/types", () => ({ targetChainId: () => 56 }));

import { GET } from "../src/app/api/jobs8183/to-deliver/route";

const job = (jobId: number, status: number, expiresIn: number) => ({
  chainId: 56,
  jobId,
  client: "0x0000000000000000000000000000000000000001",
  provider,
  budget: "2000000000000000000",
  status,
  expiredAt: now + expiresIn,
  submittedAt: status === 2 ? now - 60 : 0,
});

describe("jobs to deliver", () => {
  it("lists funded and delivered jobs that have not run out, soonest first", async () => {
    index.jobsForProviders.mockResolvedValueOnce([
      job(1, 1, 7200),
      job(2, 2, 3600),
      job(3, 3, 3600), // completed
      job(4, 4, 3600), // rejected
      job(5, 1, -60), // ran out of time
    ]);
    const res = await GET(new NextRequest(`https://api.agentsouk.xyz/api/jobs8183/to-deliver?providers=${provider}`));
    const body = (await res.json()) as { jobs: { jobId: number; stage: string; budgetUsd: number }[] };
    expect(body.jobs.map((j) => [j.jobId, j.stage])).toEqual([
      [2, "awaiting_buyer"],
      [1, "deliver"],
    ]);
    expect(body.jobs[0]!.budgetUsd).toBe(2);
  });

  it("asks for at least one wallet", async () => {
    const res = await GET(new NextRequest("https://api.agentsouk.xyz/api/jobs8183/to-deliver?providers=nope"));
    expect(res.status).toBe(400);
  });
});
