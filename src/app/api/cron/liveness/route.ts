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
// A probe costs nothing, so every listing is read on one flat cadence and no
// listing is given a long window that could hide a death.
const FRESH_FOR_MS = 6 * 3_600_000;
// A listing that is failing is the exception, and the exception runs the other
// way: it is re-probed on a short backoff, so a repaired agent is back on the
// market within minutes rather than hours. The backoff grows while it stays
// broken, and the first healthy row clears the clock and puts it back on the
// flat cadence.
export const RECOVERY_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 3_600_000];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export function isFailing(entry?: { status?: string; failing_since?: string | null } | null): boolean {
  if (!entry) return false;
  if (entry.failing_since) return true;
  return entry.status === "dead" || entry.status === "unreachable";
}

// How long before this listing is due again: the backoff while it is failing,
// the flat cadence otherwise.
export function livenessWindowMs(
  entry: { status?: string; failing_since?: string | null } | undefined,
  now: number,
): number {
  if (!isFailing(entry)) return FRESH_FOR_MS;
  const at = Date.parse(entry?.failing_since ?? "");
  if (!Number.isFinite(at)) return RECOVERY_BACKOFF_MS[0];
  const downFor = Math.max(0, now - at);
  for (const window of RECOVERY_BACKOFF_MS) {
    if (downFor < window) return window;
  }
  return RECOVERY_BACKOFF_MS[RECOVERY_BACKOFF_MS.length - 1];
}

// Whether a stored reading has aged past the window its own state earns.
export function dueForLivenessCheck(
  entry: { checkedAt?: string; status?: string; failing_since?: string | null } | undefined,
  now: number,
): boolean {
  if (!entry?.checkedAt) return true;
  const at = Date.parse(entry.checkedAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= livenessWindowMs(entry, now);
}

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
  const readingFor = (tokenId: string) => seen.get(String(tokenId));
  // each listing ages out on the window its own state earns, so a run spends its
  // slots on whatever is closest to needing a look rather than on the newest rows
  const dueAt = (a: { token_id: string }): number => {
    const entry = readingFor(String(a.token_id));
    const at = Date.parse(entry?.checkedAt ?? "");
    const read = Number.isFinite(at) ? at : 0;
    return read + livenessWindowMs(entry, startedAt);
  };
  const skipped = { healthy: 0, failing: 0 };

  const candidates = shelf.items
    .filter((a) => Number(a.chain_id) === chainId)
    .filter((a) => {
      if (all) return true;
      const entry = readingFor(String(a.token_id));
      if (dueForLivenessCheck(entry, startedAt)) return true;
      if (isFailing(entry)) skipped.failing += 1;
      else skipped.healthy += 1;
      return false;
    })
    .sort((x, y) => dueAt(x) - dueAt(y))
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
    // how many readings each tier held back this run, so the spend per tier is
    // visible without reading the rows
    skipped,
    counts,
    oracle,
    durationMs: Date.now() - startedAt,
    results: probed,
  });
}
