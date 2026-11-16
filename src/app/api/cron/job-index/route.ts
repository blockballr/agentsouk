import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { syncJobIndex } from "@/lib/job-index";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/job-index - extends the ERC-8183 job index that compare reads
// for paid work. fails closed like the other cron routes: no secret, no service

export function GET(req: NextRequest) {
  return loggedCronRun("job-index", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "job-index is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await syncJobIndex(targetChainId());
  return NextResponse.json({ success: true, ...result });
}
