import { NextRequest, NextResponse } from "next/server";
import { recentChecks } from "@/lib/history-store";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_TOKENS = 40;
const PER_TOKEN = 30;
const LIMIT = { table: "rl_agent_checks", limit: 60, windowMs: 60 * 1000 };
// checks run about hourly, so a minute at the edge loses nothing and spares the store
const CACHE = { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" };
const NO_STORE = { "cache-control": "no-store" };

// GET /api/agents/checks?tokens=2504,2521
// public: the verdict the shelf already shows, kept over time
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tokens") ?? "";
  const tokens = [...new Set(raw.split(",").map((t) => t.trim()).filter((t) => /^\d{1,78}$/.test(t)))].slice(0, MAX_TOKENS);
  if (tokens.length === 0) {
    return NextResponse.json({ success: false, error: "tokens required: token ids separated by commas" }, { status: 400, headers: NO_STORE });
  }
  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) {
      return NextResponse.json({ success: false, error: "Too many requests. Try again in a minute." }, { status: 429, headers: NO_STORE });
    }
    const recent = await recentChecks(tokens, PER_TOKEN);
    const checks: Record<string, { status: string; checkedAt: string; responseMs: number | null }[]> = {};
    for (const t of tokens) {
      checks[t] = (recent.get(t) ?? []).map((c) => ({ status: c.status, checkedAt: c.checkedAt, responseMs: c.responseMs }));
    }
    return NextResponse.json({ success: true, checks }, { headers: CACHE });
  } catch {
    // an outage is said plainly, so a reader never takes it for an agent with no checks
    return NextResponse.json({ success: false, error: "The record of checks cannot be read just now." }, { status: 503, headers: NO_STORE });
  }
}
