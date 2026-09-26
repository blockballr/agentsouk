import { NextRequest, NextResponse } from "next/server";
import { refreshIndexFromLive } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// On-demand index refresh, mirroring the verifier cron's fail-closed auth.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "refresh is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await refreshIndexFromLive(4);
    return NextResponse.json(
      { success: !report.error, ...report },
      { status: report.error ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
