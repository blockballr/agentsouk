// the PancakeSwap history cron: it runs only for the scheduler's secret, stores each
// chain's pools and positions, and reports a chain that failed instead of writing it empty
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const snap = vi.hoisted(() => ({
  SNAPSHOT_CHAINS: [97, 56],
  snapshotStoreMode: vi.fn(() => "postgres"),
  takeChainSnapshot: vi.fn(async (chainId: number) => {
    if (chainId === 56) throw new Error("rpc down\nstack");
    return {
      chainId,
      blockNumber: 134_000_000,
      takenAt: "2026-09-30T12:00:00.000Z",
      pools: [{ pool: "0x2dbb", feeTier: 500 }],
      positions: [],
    };
  }),
  saveChainSnapshot: vi.fn(async () => 1),
}));
vi.mock("@/lib/pancake-snapshot", () => snap);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function get(auth?: string) {
  const { GET } = await import("../src/app/api/cron/pancake/route");
  return GET(
    new NextRequest("https://api.agentsouk.xyz/api/cron/pancake", {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

describe("PancakeSwap history cron", () => {
  it("refuses to run without a configured secret, and with the wrong one", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer x")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "right");
    expect((await get("Bearer wrong")).status).toBe(401);
    expect(snap.takeChainSnapshot).not.toHaveBeenCalled();
  });

  it("stores the chain that answered and reports the one that did not", async () => {
    vi.stubEnv("CRON_SECRET", "right");
    const res = await get("Bearer right");
    const body = (await res.json()) as { results: Record<string, unknown>[] };
    expect(body.results).toEqual([
      { chainId: 97, blockNumber: 134_000_000, pools: 1, positions: 0, rows: 1 },
      { chainId: 56, error: "rpc down" },
    ]);
    expect(snap.saveChainSnapshot).toHaveBeenCalledTimes(1);
  });
});
