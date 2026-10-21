import { NextRequest, NextResponse } from "next/server";
import { drainPending } from "@/lib/builder/outbox";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/notifications  { limit? }
// drains the pending outbox rows: sends each (Resend when configured, log
// otherwise) and records sent/failed. Gated by CRON_SECRET when set.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ success: false, error: "unauthorized" }, 401);
  }
  const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
  const limit = typeof body?.limit === "number" && body.limit > 0 ? body.limit : 50;
  try {
    const counts = await drainPending(limit);
    return json({ success: true, ...counts });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "drain failed" }, 503);
  }
}
