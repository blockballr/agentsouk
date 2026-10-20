import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { refreshIndexFromLive } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(req: NextRequest) {
  return loggedCronRun("refresh-full", () => refresh(req));
}

// Nightly full-catalogue refresh: pulls as many pages as the budget allows so
// the in-memory shelf tracks the live registry, not just the committed snapshot.
// Fail-closed like the 15-minute refresh: a failed pull leaves the snapshot
// untouched rather than emptying the shelf.
async function refresh(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "refresh is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await refreshIndexFromLive(10);
    return NextResponse.json(
      { success: !report.error, ...report },
      { status: report.error ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return refresh(req);
}
