// Keeps the shelf hot. The shelf response is cached at the edge for ten
// minutes, so after a quiet spell the next visitor pays a cold function start
// and a cold database connection. Asking for the same two URLs every few
// minutes means a visitor almost never is that next one, and the timing this
// returns is the honest measure of what a miss costs.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// the two shapes the web app asks for on first paint, from lib/api.ts
const PATHS = [
  "/api/agents?type=jobs&metric=score&limit=48",
  "/api/agents?type=all&metric=score&limit=12",
  "/api/network",
];

const TIMEOUT_MS = 15_000;

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.VAULT_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (secrets.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return secrets.includes(header.replace(/^Bearer\s+/i, ""));
}

async function warm(origin: string, path: string) {
  const started = Date.now();
  const abort = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await fetch(origin + path, { cache: "no-store", signal: abort });
    // drain the body so the function finishes its work and the edge stores it
    const body = await res.text();
    return {
      path,
      status: res.status,
      ms: Date.now() - started,
      cache: res.headers.get("x-vercel-cache"),
      bytes: body.length,
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  // the deployed host, not a hardcoded one, so a preview warms itself
  const origin = new URL(req.url).origin;
  const results = await Promise.all(PATHS.map((path) => warm(origin, path)));
  const failed = results.filter((r) => r.status !== 200);

  return NextResponse.json(
    { success: failed.length === 0, origin, results },
    { status: failed.length === 0 ? 200 : 500, headers: { "cache-control": "no-store" } },
  );
}

export function POST(req: NextRequest) {
  return GET(req);
}
