import { NextRequest, NextResponse } from "next/server";
import {
  discoverCandidates,
  loadScoutJson,
  saveScoutJson,
} from "@/lib/scout-pipeline";
import type { ScoutCandidate, ScoutLog } from "@/lib/scout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/scout/discover?secret=...&terms=2&pages=1&limit=200
// writes data/scout/candidates.json and returns the discover log

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== (process.env.INDEX_SECRET ?? "dev")) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const terms = Number(req.nextUrl.searchParams.get("terms") ?? 2);
  const pages = Number(req.nextUrl.searchParams.get("pages") ?? 1);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);

  const result = await discoverCandidates({
    maxTermsPerCategory: terms,
    recentPages: pages,
    limit,
  });

  await saveScoutJson("candidates.json", {
    updatedAt: new Date().toISOString(),
    fetched: result.fetched,
    counts: result.byCategory,
    candidates: result.candidates,
  });
  await saveScoutJson("log-discover.json", result.log);

  return NextResponse.json({
    success: true,
    fetched: result.fetched,
    candidates: result.candidates.length,
    agents: result.candidates,
    byCategory: result.byCategory,
    bySource: result.bySource,
    log: result.log,
  });
}

export async function GET() {
  const data = await loadScoutJson<{
    updatedAt: string;
    fetched: number;
    counts: Record<string, number>;
    candidates: ScoutCandidate[];
  }>("candidates.json");
  const log = await loadScoutJson<ScoutLog>("log-discover.json");
  return NextResponse.json({
    success: true,
    updatedAt: data?.updatedAt ?? null,
    fetched: data?.fetched ?? 0,
    counts: data?.counts ?? {},
    candidates: data?.candidates?.length ?? 0,
    agents: data?.candidates ?? [],
    log,
  });
}
