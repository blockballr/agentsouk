import { NextResponse } from "next/server";
import { loadScoutJson } from "@/lib/scout-pipeline";
import type { ScoutCandidate, ScoutLog } from "@/lib/scout";

export const dynamic = "force-dynamic";

// GET /api/scout/status - last discover/verify run summary

export async function GET() {
  const candidates = await loadScoutJson<{
    updatedAt: string;
    fetched: number;
    counts: Record<string, number>;
    candidates: ScoutCandidate[];
  }>("candidates.json");
  const verifications = await loadScoutJson<{
    updatedAt: string;
    probed: number;
    delivered: number;
    dead: number;
    unreachable: number;
  }>("verifications.json");
  const log = await loadScoutJson<ScoutLog>("log-discover.json");

  return NextResponse.json({
    success: true,
    scout: {
      discover: candidates
        ? {
            updatedAt: candidates.updatedAt,
            fetched: candidates.fetched,
            candidates: candidates.candidates?.length ?? 0,
            counts: candidates.counts ?? {},
          }
        : null,
      verify: verifications ?? null,
      log,
    },
  });
}
