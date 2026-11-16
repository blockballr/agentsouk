import { NextResponse } from "next/server";
import { stationHires, stationOperations, stationOverview, stationShelfHealth } from "@/lib/station-data";

export const dynamic = "force-dynamic";

// GET /api/station/preview - the station's read-only panel for anyone, judges
// included, with nothing that can change state. it keeps the counts, the charts,
// the shelf's states, the scheduled jobs' health and recent hires; it drops
// owner wallets, error notes, buyers' task text and everything a member can do

const TTL_MS = 60_000;
let cached: { at: number; body: Record<string, unknown> } | null = null;

const short = (a: string | null | undefined) => (a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a ?? null);

export async function GET(): Promise<NextResponse> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "cache-control": "public, max-age=60" } });
  }
  try {
    const [overview, shelf, ops, hires] = await Promise.all([
      stationOverview(),
      stationShelfHealth(),
      stationOperations(),
      stationHires(60).catch(() => []),
    ]);
    const body = {
      success: true,
      preview: true,
      generatedAt: new Date().toISOString(),
      overview: {
        chainId: overview.chainId,
        windows: overview.windows,
        categories: overview.categories,
        agentsListed: overview.agentsListed,
        agentsAnswering: overview.agentsAnswering,
        offMarket: overview.offMarket,
        passports: overview.passports,
        failedChecksToday: overview.failedChecksToday,
        hiresByDay: overview.hiresByDay,
        checksByDay: overview.checksByDay,
        stuck: overview.stuck.length,
      },
      shelf: {
        windowDays: shelf.windowDays,
        onShelf: shelf.onShelf,
        neverEligible: shelf.neverEligible,
        failing: shelf.failing.map((r) => ({ tokenId: r.tokenId, name: r.name, category: r.category, ours: r.ours, status: r.status, daysLeft: r.daysLeft })),
        delisted: shelf.delisted.map((r) => ({ tokenId: r.tokenId, name: r.name, category: r.category, ours: r.ours, daysOff: r.daysOff })),
      },
      operations: {
        settlement: ops.settlement,
        jobs: ops.jobs.map((j) => ({ name: j.name, finishedAt: j.finishedAt, ok: j.ok })),
        relay: { address: ops.relay.address, balance: ops.relay.balance },
        stores: ops.stores,
      },
      // buyers only: our own checks and team wallets are not hires
      hires: hires.filter((h) => h.payer === "buyer").slice(0, 15).map((h) => ({
        createdAt: h.createdAt,
        agentName: h.agentName,
        tokenId: h.tokenId,
        amount: h.amount,
        symbol: h.symbol,
        txHash: h.txHash,
        buyer: short(h.client),
      })),
    };
    cached = { at: Date.now(), body };
    return NextResponse.json(body, { headers: { "cache-control": "public, max-age=60" } });
  } catch (e) {
    console.error("[station preview]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "The station cannot be read just now." }, { status: 503 });
  }
}
