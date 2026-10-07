// The escrow status read behind the hire cards: a settled payment reports its
// on-chain state as flat JSON, a payment that never entered escrow has no row,
// and with no funder in env the whole answer is nothing to show. The dispute
// window is read once per funder and counted from the verified delivery
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  jobs: {} as Record<string, unknown>,
  window: 3600n as bigint | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === "disputeWindow") {
          if (chain.window === null) throw new Error("fetch failed");
          return chain.window;
        }
        if (functionName === "jobOf") {
          const [jobId] = args as [string];
          const row = chain.jobs[jobId];
          if (!row) throw new Error("execution reverted");
          return row;
        }
        throw new Error(`unexpected read: ${functionName}`);
      },
    }),
  };
});

import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { GET as escrowRoute } from "../src/app/api/escrow/route";
import { escrowJobId } from "../src/lib/escrow";

const FUNDER = getAddress(`0x${"9c".repeat(20)}`);
const COLD_FUNDER = getAddress(`0x${"77".repeat(20)}`);
const BUYER = getAddress(`0x${"4b".repeat(20)}`);
const AGENT_WALLET = getAddress(`0x${"11".repeat(20)}`);

function seed(
  paymentId: string,
  over: Partial<{
    buyer: string;
    payTo: string;
    amount: bigint;
    fundedAt: bigint;
    verifiedAt: bigint;
    status: number;
  }> = {},
) {
  chain.jobs[escrowJobId(paymentId)] = {
    buyer: over.buyer ?? BUYER,
    payTo: over.payTo ?? AGENT_WALLET,
    token: `0x${"93".repeat(20)}`,
    amount: over.amount ?? 2n * 10n ** 18n,
    fundedAt: over.fundedAt ?? 1791373327n,
    verifiedAt: over.verifiedAt ?? 0n,
    receiptId: `0x${"00".repeat(32)}`,
    status: over.status ?? 0,
  };
}

function get(ids: string[]) {
  const qs = ids.map((id) => encodeURIComponent(id)).join(",");
  return escrowRoute(new NextRequest(`http://localhost/api/escrow?paymentIds=${qs}`));
}

beforeEach(() => {
  chain.jobs = {};
  chain.window = 3600n;
  process.env.TARGET_CHAIN = "97";
  process.env.ESCROW_FUNDER_ADDRESS = FUNDER;
});

afterEach(() => {
  delete process.env.ESCROW_FUNDER_ADDRESS;
  delete process.env.TARGET_CHAIN;
});

describe("escrow status route", () => {
  it("reads as nothing to show with no funder configured", async () => {
    delete process.env.ESCROW_FUNDER_ADDRESS;
    seed("req_held");
    const res = await get(["req_held"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funder: null, jobs: [] });
  });

  it("reports a held payment with chain types flattened for transport", async () => {
    seed("req_held");
    const res = await get(["req_held"]);
    const body = await res.json();
    expect(body.funder).toBe(FUNDER);
    expect(body.jobs).toEqual([
      {
        paymentId: "req_held",
        buyer: BUYER,
        payTo: AGENT_WALLET,
        amount: "2000000000000000000",
        status: 0,
        fundedAt: 1791373327,
        verifiedAt: 0,
        windowEndsAt: null,
      },
    ]);
  });

  it("counts the dispute window from the verified delivery", async () => {
    seed("req_verified", { verifiedAt: 1791373545n });
    const body = await (await get(["req_verified"])).json();
    expect(body.jobs[0]).toMatchObject({
      status: 0,
      verifiedAt: 1791373545,
      windowEndsAt: 1791373545 + 3600,
    });
  });

  it("leaves the window unknown when the window read fails", async () => {
    // a funder this process has never read before, so the immutable window is
    // asked for rather than served from the per-funder cache
    process.env.ESCROW_FUNDER_ADDRESS = COLD_FUNDER;
    chain.window = null;
    seed("req_verified", { verifiedAt: 1791373545n });
    const body = await (await get(["req_verified"])).json();
    expect(body.jobs[0]).toMatchObject({ verifiedAt: 1791373545, windowEndsAt: null });
  });

  it("reports released and refunded rows by their status", async () => {
    seed("req_released", { status: 1, verifiedAt: 1791373545n });
    seed("req_refunded", { status: 2 });
    const body = await (await get(["req_released", "req_refunded"])).json();
    expect(body.jobs.map((j: { paymentId: string; status: number }) => [j.paymentId, j.status])).toEqual([
      ["req_released", 1],
      ["req_refunded", 2],
    ]);
  });

  it("gives a payment that never entered escrow no row", async () => {
    seed("req_held");
    const body = await (await get(["req_never", "req_held"])).json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].paymentId).toBe("req_held");
  });

  it("deduplicates the id list and caps what it asks the chain for", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `req_${i}`);
    ids.push("req_0", "req_1");
    for (const id of ids) seed(id);
    const body = await (await get(ids)).json();
    expect(body.jobs).toHaveLength(40);
    const reported = body.jobs.map((j: { paymentId: string }) => j.paymentId);
    expect(new Set(reported).size).toBe(40);
  });
});
