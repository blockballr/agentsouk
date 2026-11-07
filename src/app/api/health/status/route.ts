// Public read of the standing watch's last runs. No secret: it exposes timing
// and pass or fail, never a buyer, a position or a key. A buyer screen uses it
// to say whether the guard is actually looking.

import { NextResponse } from "next/server";
import { recentCronRuns } from "@/lib/history-store";
import { watchStatus } from "@/lib/health-status";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await recentCronRuns("health-watch", 10);
  const status = watchStatus(runs);
  return NextResponse.json(
    { ...status, chainId: targetChainId() },
    { headers: { "cache-control": "no-store" } },
  );
}
