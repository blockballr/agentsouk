import { NextRequest, NextResponse } from "next/server";
import { saveAltanaSession, type AltanaSessionRecord } from "@/lib/altana-store";

export const dynamic = "force-dynamic";

// POST /api/admin/sync-altana  (Authorization: Bearer $CRON_SECRET)
// body: { sessions: { [tokenId]: { chainId, label, walletAddress, sessionBlob, sessionKey, adminKey?, expiry?, createdAt? } } }
// persists the sessions to the production database. one-time setup helper.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { sessions?: Record<string, Record<string, unknown>> } | null;
  if (!body?.sessions) return NextResponse.json({ error: "sessions required" }, { status: 400 });

  let count = 0;
  const errors: string[] = [];
  for (const [tokenId, rec] of Object.entries(body.sessions)) {
    if (!rec.sessionBlob || !rec.sessionKey || !rec.walletAddress) {
      errors.push(`${tokenId}: missing sessionBlob/sessionKey/walletAddress`);
      continue;
    }
    const record: AltanaSessionRecord = {
      tokenId,
      chainId: Number(rec.chainId ?? 56),
      label: String(rec.label ?? tokenId),
      walletAddress: String(rec.walletAddress),
      sessionBlob: String(rec.sessionBlob),
      sessionKey: String(rec.sessionKey),
      adminKey: rec.adminKey ? String(rec.adminKey) : undefined,
      expiry: rec.expiry != null ? Number(rec.expiry) : undefined,
      createdAt: String(rec.createdAt ?? new Date().toISOString()),
    };
    const ok = await saveAltanaSession(record);
    if (ok) count++;
    else errors.push(`${tokenId}: save failed`);
  }
  return NextResponse.json({ success: true, synced: count, errors });
}