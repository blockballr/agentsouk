import { NextRequest, NextResponse } from "next/server";
import {
  loadScoutJson,
  probeCandidateEndpoint,
  probeToVerification,
  saveScoutJson,
  scoutRateGapMs,
} from "@/lib/scout-pipeline";
import type { ScoutCandidate } from "@/lib/scout";
import { upsertVerification } from "@/lib/verifications-store";
import { scoreDelivery } from "@/lib/quality";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// POST /api/scout/verify?secret=...&limit=25
// reads data/scout/candidates.json, probes endpoints, writes verifications
// plus data/scout/verifications.json

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== (process.env.INDEX_SECRET ?? "dev")) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") ?? 15) || 15));
  const store = await loadScoutJson<{ candidates?: ScoutCandidate[] }>("candidates.json");
  const candidates = (store?.candidates ?? []).slice(0, limit);
  if (candidates.length === 0) {
    return NextResponse.json(
      { success: false, error: "no scout candidates; run discover first" },
      { status: 400 },
    );
  }

  const gap = Math.max(scoutRateGapMs(), 2000);
  const results: {
    tokenId: string;
    name: string;
    category: string;
    status: string;
    responseMs: number;
    detail: string;
  }[] = [];

  for (const cand of candidates) {
    const t0 = Date.now();
    const probe = await probeCandidateEndpoint(cand);
    const ms = Date.now() - t0;
    const verdict = probeToVerification(cand, probe, ms);
    const quality = probe.ok
      ? scoreDelivery(probe.detail)
      : undefined;
    await upsertVerification(
      verdict.tokenId,
      verdict.name,
      verdict.category,
      verdict.status,
      verdict.responseMs,
      quality
        ? { grade: quality.grade, reason: quality.reason, model: "deterministic" }
        : undefined,
    );
    results.push({
      tokenId: verdict.tokenId,
      name: verdict.name,
      category: verdict.category,
      status: verdict.status,
      responseMs: verdict.responseMs,
      detail: probe.detail,
    });
    await sleep(gap);
  }

  const summary = {
    updatedAt: new Date().toISOString(),
    probed: results.length,
    delivered: results.filter((r) => r.status === "delivered").length,
    dead: results.filter((r) => r.status === "dead").length,
    unreachable: results.filter((r) => r.status === "unreachable").length,
    results,
  };
  await saveScoutJson("verifications.json", summary);

  return NextResponse.json({ success: true, ...summary });
}

export async function GET() {
  const data = await loadScoutJson<{
    updatedAt: string;
    probed: number;
    delivered: number;
    dead: number;
    unreachable: number;
  }>("verifications.json");
  return NextResponse.json({ success: true, ...(data ?? { probed: 0 }) });
}
