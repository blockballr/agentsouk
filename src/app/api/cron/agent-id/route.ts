import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { syncAgentIds } from "@/lib/agent-id";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/agent-id - extends the Agent ID index (mints and the vault hires their holders open)
// from where the last run stopped. fails closed like the other cron routes: no secret, no service

export function GET(req: NextRequest) {
  return loggedCronRun("agent-id", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "agent-id is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await syncAgentIds();
  return NextResponse.json({ success: true, ...result });
}
