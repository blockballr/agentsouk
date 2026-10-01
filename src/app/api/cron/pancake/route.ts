import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import {
  SNAPSHOT_CHAINS,
  saveChainSnapshot,
  snapshotStoreMode,
  takeChainSnapshot,
} from "@/lib/pancake-snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// PancakeSwap history for the position chart: every run reads the WBNB/USDT pools and our
// agent wallet's positions on each chain at one block and stores them. Read-only on chain;
// a chain that fails to answer is reported and skipped, never written as empty.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run(): Promise<NextResponse> {
  const results = await Promise.all(
    SNAPSHOT_CHAINS.map(async (chainId) => {
      try {
        const snap = await takeChainSnapshot(chainId);
        const rows = await saveChainSnapshot(snap);
        return {
          chainId,
          blockNumber: snap.blockNumber,
          pools: snap.pools.length,
          positions: snap.positions.length,
          rows,
        };
      } catch (e) {
        return { chainId, error: (e as Error).message.split("\n")[0] };
      }
    }),
  );
  return NextResponse.json({ success: true, store: snapshotStoreMode(), results });
}

function refusal(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: "no cron secret configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return refusal(req) ?? loggedCronRun("pancake", run);
}

// the scheduler issues a GET; only a caller holding the bearer secret reaches the run
export async function GET(req: NextRequest): Promise<NextResponse> {
  return refusal(req) ?? loggedCronRun("pancake", run);
}
