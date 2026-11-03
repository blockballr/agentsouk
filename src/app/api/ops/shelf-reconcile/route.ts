import { NextRequest, NextResponse } from "next/server";
import { reconcileFirstPartyShelf } from "@/lib/shelf-admission";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/ops/shelf-reconcile
// A house token that is registered and owned but has no shelf summary never
// reaches browse. This admits the difference and reports the rest, so the gap is
// closed on demand and by the daily maintenance pass.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ success: false, error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const chainId = targetChainId();
  const rows = await reconcileFirstPartyShelf(chainId);
  return NextResponse.json({
    success: true,
    chainId,
    admitted: rows.filter((r) => r.state === "admitted").length,
    failed: rows.filter((r) => r.state === "failed").length,
    rows,
  });
}
