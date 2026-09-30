// A job this instance funded before another instance submitted it must read as
// Submitted everywhere, not Funded. Before the reads went durable-first, the
// complete action answered "job is Funded" for a job the store already held as
// Submitted, and lists kept serving the stale copy indefinitely.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.stubEnv("TARGET_CHAIN", "97");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("TARGET_CHAIN", "97");
});

const CLIENT = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const PROVIDER = "0x84fedabd1b83443ad86796c15619494878b64180";
const PAYMENT = "pay_stale_read_test";

// Committed rows only, like postgres: what the store holds is the truth no
// instance memory can overrule.
const committed = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));

vi.mock("../src/lib/durable-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/durable-store")>();
  return {
    ...actual,
    saveJob: vi.fn(async (job: { id: string }) => {
      committed.rows.set(job.id, clone(job));
    }),
    loadJob: vi.fn(async (id: string) => {
      const row = committed.rows.get(id);
      return row === undefined ? undefined : clone(row);
    }),
    loadJobByPayment: vi.fn(async (paymentId: string) => {
      for (const row of committed.rows.values()) {
        const r = row as { paymentId?: string };
        if (r.paymentId === paymentId) return clone(row);
      }
      return undefined;
    }),
    loadJobs: vi.fn(async () => [...committed.rows.values()].map(clone)),
    loadJobsByClient: vi.fn(async (client: string) =>
      [...committed.rows.values()].map(clone).filter(
        (r) => (r as { client?: string }).client?.toLowerCase() === client.toLowerCase(),
      ),
    ),
  };
});

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { GET, POST as actOnJob } from "../src/app/api/jobs/[jobId]/route";
import { GET as listJobsRoute } from "../src/app/api/jobs/route";
import { fundJob, getJobAsync, listJobs } from "../src/lib/jobs";

const KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const signer = privateKeyToAccount(KEY);
const SIGNER = signer.address.toLowerCase();

function jobUrl(id: string) {
  return new NextRequest(`http://localhost/api/jobs/${id}`);
}

function completeBody(jobId: string, signature: string) {
  return new NextRequest(`http://localhost/api/jobs/${jobId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "complete", by: SIGNER, reason: "complete", signature }),
  });
}

describe("durable-first job reads", () => {
  it("serves the stored Submitted row over a stale in-memory Funded copy", async () => {
    const funded = fundJob({
      paymentId: PAYMENT,
      client: SIGNER,
      provider: PROVIDER,
      description: "stale read test",
      chainId: 97,
      tokenId: "2504",
      agentName: "Souk Health Guard",
      budgetUsd: 2,
    });
    expect(funded.status).toBe("Funded");

    // another instance persists the submit; this instance never sees it
    const row = clone(committed.rows.get(funded.id)) as Record<string, unknown>;
    row.status = "Submitted";
    row.deliverable = "health factor 1.6";
    row.history = [...(row.history as unknown[]), { at: new Date().toISOString(), status: "Submitted" }];
    committed.rows.set(funded.id, row);

    expect((await getJobAsync(funded.id))?.status).toBe("Submitted");

    const listed = await listJobs(50);
    expect(listed.find((j) => j.id === funded.id)?.status).toBe("Submitted");

    const res = await GET(jobUrl(funded.id), { params: Promise.resolve({ jobId: funded.id }) } as never);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { status: string } }).job.status).toBe("Submitted");

    const message = [
      "Agent Souk job action",
      `jobId: ${funded.id}`,
      "action: complete",
      `address: ${SIGNER}`,
      "reason: complete",
      "deliverable: ",
    ].join("\n");
    const signature = await signer.signMessage({ message });
    const done = await actOnJob(completeBody(funded.id, signature), {
      params: Promise.resolve({ jobId: funded.id }),
    } as never);
    expect(done.status).toBe(200);
    const finalRow = committed.rows.get(funded.id) as { status: string; attestation?: string };
    expect(finalRow.status).toBe("Completed");
    expect(finalRow.attestation).toBe("complete");
  });

  // a reloaded detail page restores its run pane from this read, so it must
  // answer with the one job the payment funded, or with none
  it("returns the job one payment funded, and nothing for an unknown payment", async () => {
    const funded = fundJob({
      paymentId: "pay_reload_test",
      client: SIGNER,
      provider: PROVIDER,
      description: "reload test",
      chainId: 97,
      tokenId: "2504",
      agentName: "Souk Health Guard",
      budgetUsd: 2,
    });

    const found = await listJobsRoute(new NextRequest("http://localhost/api/jobs?paymentId=pay_reload_test"));
    const body = (await found.json()) as { jobs: { id: string; status: string }[] };
    expect(body.jobs.map((j) => j.id)).toEqual([funded.id]);
    expect(body.jobs[0].status).toBe("Funded");

    const none = await listJobsRoute(new NextRequest("http://localhost/api/jobs?paymentId=pay_unknown"));
    expect(((await none.json()) as { jobs: unknown[] }).jobs).toEqual([]);
  });

  // settle left Funded in this instance's memory while another instance stored
  // Submitted; a reload that read memory first offered Refund instead of Complete
  it("serves the stored Submitted row by payment over a stale Funded copy", async () => {
    const funded = fundJob({
      paymentId: "pay_reload_stale",
      client: SIGNER,
      provider: PROVIDER,
      description: "stale reload test",
      chainId: 97,
      tokenId: "2504",
      agentName: "Souk Health Guard",
      budgetUsd: 2,
    });
    const row = clone(committed.rows.get(funded.id)) as Record<string, unknown>;
    row.status = "Submitted";
    committed.rows.set(funded.id, row);

    const res = await listJobsRoute(new NextRequest("http://localhost/api/jobs?paymentId=pay_reload_stale"));
    expect(((await res.json()) as { jobs: { status: string }[] }).jobs[0].status).toBe("Submitted");
  });
});
