// Public read of the standing watch's last runs. No secret: it exposes timing,
// gas and pass or fail, never a buyer, a position or a key. A buyer screen uses
// it to say whether the guard is actually looking and able to act.

import { NextResponse } from "next/server";
import { readPipelineState, recentCronRuns } from "@/lib/history-store";
import { parseGasState, watchStatus } from "@/lib/health-status";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const [runs, gasState] = await Promise.all([
    recentCronRuns("health-watch", 10),
    readPipelineState("health:gas"),
  ]);
  const status = watchStatus(runs);
  const gas = parseGasState(gasState);
  return NextResponse.json(
    { ...status, gas, chainId: targetChainId() },
    { headers: { "cache-control": "no-store" } },
  );
}
