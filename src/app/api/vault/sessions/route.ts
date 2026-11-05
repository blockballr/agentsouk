// Session sync for the per-agent executor. The sessions live in the database,
// and a re-granted session only reaches the deployment when it is written there.
// The operator posts the records once; reads never return a key, only the token,
// the wallet, the expiry and the scope the session carries.
import { NextRequest, NextResponse } from "next/server";
import { saveAltanaSession } from "@/lib/altana-store";
import { readSessionScope } from "@/lib/session-scope";
import { loadSessionsWithAdmin } from "@/lib/session-renewal";
import { vaultFor } from "@/lib/vault";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

// the same secret pair the executor accepts, so one operator key runs both
function allowed(req: NextRequest): boolean {
  const secrets = [process.env.VAULT_SECRET, process.env.CRON_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (secrets.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return secrets.includes(header.replace(/^Bearer\s+/i, ""));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!allowed(req)) return json({ error: "unauthorized" }, 401);
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || 56;
  const vault = vaultFor(chainId);
  const rows = await loadSessionsWithAdmin(chainId);
  return json({
    success: true,
    chainId,
    vault,
    sessions: rows.map((row) =>
      readSessionScope(row.tokenId, row.walletAddress, row.sessionBlob, row.expiry ?? null, vault),
    ),
    // one flag for a scheduler: a session that cannot call the live vault needs
    // a re-grant, and a session near expiry needs one before it lapses
    stale: rows
      .filter((row) => readSessionScope(row.tokenId, row.walletAddress, row.sessionBlob, row.expiry ?? null, vault).stale)
      .map((row) => row.tokenId),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!allowed(req)) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => null)) as { sessions?: unknown } | null;
  if (!Array.isArray(body?.sessions)) return json({ error: "sessions array required" }, 400);

  const saved: string[] = [];
  const skipped: string[] = [];
  for (const raw of body.sessions) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const tokenId = String(record.tokenId ?? "");
    const chainId = Number(record.chainId);
    const walletAddress = String(record.walletAddress ?? "");
    const sessionBlob = String(record.sessionBlob ?? "");
    const sessionKey = String(record.sessionKey ?? "");
    if (!tokenId || !walletAddress || !sessionBlob || !sessionKey || !Number.isFinite(chainId)) {
      skipped.push(tokenId || "unknown");
      continue;
    }
    const ok = await saveAltanaSession({
      tokenId,
      chainId,
      label: String(record.label ?? tokenId),
      walletAddress,
      sessionBlob,
      sessionKey,
      // renewal re-grants from the admin key, so the stored record keeps it
      adminKey: typeof record.adminKey === "string" && record.adminKey.length > 0 ? record.adminKey : undefined,
      expiry: record.expiry != null ? Number(record.expiry) : undefined,
      createdAt: String(record.createdAt ?? new Date().toISOString()),
    });
    if (ok) saved.push(tokenId);
    else skipped.push(tokenId);
  }
  return json({ success: skipped.length === 0, saved, skipped });
}
