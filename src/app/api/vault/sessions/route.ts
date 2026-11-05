// Session sync for the per-agent executor. The sessions live in the database,
// and a re-granted session only reaches the deployment when it is written there.
// The operator posts the re-granted records once; reads never return a key, only
// the token, the wallet, the expiry and the targets the session may call.
import { NextRequest, NextResponse } from "next/server";
import { loadAltanaSessionsFromDb, saveAltanaSession } from "@/lib/altana-store";

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

// what the session may call, read from the serialized grant it was issued with
function permittedTargets(blob: string): string[] {
  try {
    const parsed = JSON.parse(blob) as { permissions?: { calls?: { to?: unknown }[] } };
    return (parsed.permissions?.calls ?? [])
      .map((call) => (typeof call?.to === "string" ? call.to : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!allowed(req)) return json({ error: "unauthorized" }, 401);
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || 56;
  const rows = await loadAltanaSessionsFromDb(chainId);
  return json({
    success: true,
    chainId,
    sessions: rows.map((row) => ({
      tokenId: row.tokenId,
      walletAddress: row.walletAddress,
      expiry: row.expiry ?? null,
      calls: permittedTargets(row.sessionBlob),
    })),
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
      // the executor never needs the admin key, so it is not accepted here
      expiry: record.expiry != null ? Number(record.expiry) : undefined,
      createdAt: String(record.createdAt ?? new Date().toISOString()),
    });
    if (ok) saved.push(tokenId);
    else skipped.push(tokenId);
  }
  return json({ success: skipped.length === 0, saved, skipped });
}
