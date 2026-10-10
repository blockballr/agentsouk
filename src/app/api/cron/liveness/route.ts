import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { probeCandidateEndpoint, probeToVerification, scoutRateGapMs } from "@/lib/scout-pipeline";
import type { ScoutCandidate } from "@/lib/scout";
import { queryAgents } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { upsertVerification } from "@/lib/verifications-store";
import { scoreDelivery } from "@/lib/quality";
import { targetChainId } from "@/lib/types";
import { livenessGrade, livenessMethod, postLiveness } from "@/lib/liveness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// the run stops just short of the platform's own ceiling, so a slow endpoint
// cannot turn a sweep into a timeout
const RUN_BUDGET_MS = 4 * 60 * 1000;
// a listing checked inside this window is left alone, so repeated runs spend
// their budget on the listings nobody has looked at lately
const FRESH_FOR_MS = 6 * 3_600_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// GET /api/cron/liveness - the reachability sweep. Listings are probed over
// their own registered endpoints, the reading the pages show is recorded, and
// the same reading is posted to the liveness oracle. No hire is settled and no
// agent is paid for answering, which is what makes a sweep repeatable.
export function GET(req: NextRequest) {
  return loggedCronRun("liveness", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "liveness sweep is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const chainId = targetChainId();
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  );
  const all = req.nextUrl.searchParams.get("all") === "1";

  const shelf = await queryAgents({ limit: 5000, includeHouse: true });
  const seen = await loadVerifications(chainId);
  const cutoff = startedAt - FRESH_FOR_MS;
  const checkedAtOf = (tokenId: string): number => {
    const at = Date.parse(seen.get(String(tokenId))?.checkedAt ?? "");
    return Number.isFinite(at) ? at : 0;
  };

  const candidates = shelf.items
    .filter((a) => Number(a.chain_id) === chainId)
    .filter((a) => all || checkedAtOf(String(a.token_id)) < cutoff)
    // oldest reading first, so a repeated run walks the shelf instead of the head
    .sort((x, y) => checkedAtOf(String(x.token_id)) - checkedAtOf(String(y.token_id)))
    .slice(0, limit)
    .map((a) => {
      const candidate: ScoutCandidate = {
        agent_id: `${chainId}:${a.token_id}`,
        token_id: String(a.token_id),
        chain_id: chainId,
        name: a.name,
        description: a.description ?? null,
        category: (a.category ?? "general") as ScoutCandidate["category"],
        endpoint: a.a2a_endpoint ?? a.mcp_server ?? null,
        endpointType: a.mcp_server ? "mcp" : "a2a",
        source: "recent",
        discoveredAt: new Date().toISOString(),
      };
      return candidate;
    });

  const gap = Math.max(scoutRateGapMs(), 2000);
  const deadline = startedAt + RUN_BUDGET_MS;
  const counts = { online: 0, gated: 0, dead: 0, unreachable: 0, noEndpoint: 0 };
  const oracle = { posted: 0, failed: 0, skipped: 0 };
  const probed: { tokenId: string; name: string; status: string; responseMs: number; heartbeat?: string }[] = [];

  for (const cand of candidates) {
    if (Date.now() > deadline) break;

    const t0 = Date.now();
    const probe = await probeCandidateEndpoint(cand);
    const responseMs = Date.now() - t0;

    // a listing with nothing callable yet has no reading to give: recording it
    // would turn the index's lag into a verdict against the agent
    if (probe.detail.includes("no callable")) {
      counts.noEndpoint += 1;
      continue;
    }

    const verdict = probeToVerification(cand, probe, responseMs);
    const quality = probe.ok ? scoreDelivery(probe.detail) : undefined;
    await upsertVerification(
      verdict.tokenId,
      verdict.name,
      verdict.category,
      verdict.status,
      verdict.responseMs,
      quality ? { grade: quality.grade, reason: quality.reason, model: "deterministic" } : undefined,
    );

    const heartbeat = await postLiveness({
      chainId,
      tokenId: verdict.tokenId,
      grade: livenessGrade(probe),
      method: livenessMethod(probe.protocol),
      responseMs: verdict.responseMs,
      detail: probe.detail,
    });
    if (heartbeat.ok) oracle.posted += 1;
    else if (heartbeat.skipped) oracle.skipped += 1;
    else oracle.failed += 1;

    if (verdict.status === "delivered") counts.online += 1;
    else if (verdict.status === "gated") counts.gated += 1;
    else if (verdict.status === "unreachable") counts.unreachable += 1;
    else counts.dead += 1;

    probed.push({
      tokenId: verdict.tokenId,
      name: verdict.name,
      status: verdict.status,
      responseMs: verdict.responseMs,
      ...(heartbeat.ok && heartbeat.hash ? { heartbeat: heartbeat.hash } : {}),
    });
    await sleep(gap);
  }

  return NextResponse.json({
    success: true,
    chainId,
    considered: candidates.length,
    probed: probed.length,
    counts,
    oracle,
    durationMs: Date.now() - startedAt,
    results: probed,
  });
}
