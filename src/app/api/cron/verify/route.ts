import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";
import {
  fetchJson,
  baseUrl,
  verifyAndRecord,
  type SweepCandidate,
} from "@/lib/verify-candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The chain this deployment settles on, so the candidate filter below matches this chain's agents.
const CHAIN_ID = targetChainId();
const VERIFY_LIMIT = Math.max(1, Math.min(50, Number(process.env.VERIFY_LIMIT ?? 10) || 10));
const BUDGET_MS = 4 * 60 * 1000;

// The verifier signs its own EIP-3009 authorizations, so it needs a funded buyer key.
const RELAY_KEY = process.env.RELAY_PRIVATE_KEY as `0x${string}` | undefined;

// Per-invocation sweep clock: module state survives on warm instances, so a
// module-level start time reads stale and the budget check exits early.
export function sweepBudget() {
  const startedAt = Date.now();
  return {
    startedAt,
    outOfTime: () => Date.now() - startedAt > BUDGET_MS,
  };
}

// Queued fresh listings lead, then tokens still waiting on their first probe,
// then the score-ranked fill. Each token appears once and the total never
// exceeds the limit, so a new listing is swept within a run or two while the
// per-run spend stays bounded.
export function mergeSweepCandidates(
  queued: { tokenId: string; name: string; category: string }[],
  agents: { token_id: number; name: string; category?: string; chain_id?: number; average_score?: number }[],
  chainId: number,
  limit: number,
  verifiedIds: Set<string> = new Set(),
): SweepCandidate[] {
  const queuedIds = new Set(queued.map((q) => q.tokenId));
  const rest = agents.filter((a) => (a.chain_id ?? chainId) === chainId && !queuedIds.has(String(a.token_id)));
  const fill = [...rest]
    .sort((a, b) => {
      const fa = verifiedIds.has(String(a.token_id)) ? 1 : 0;
      const fb = verifiedIds.has(String(b.token_id)) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return (b.average_score ?? 0) - (a.average_score ?? 0);
    })
    .slice(0, Math.max(0, limit - queued.length))
    .map((a) => ({
      chainId,
      tokenId: String(a.token_id),
      name: a.name,
      category: a.category ?? "general",
    }));
  return [
    ...queued.map((q) => ({ chainId, tokenId: q.tokenId, name: q.name, category: q.category })),
    ...fill,
  ];
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  // fails closed: an unset secret must refuse, because this route spends real money on every candidate
  if (!cronSecret) {
    return NextResponse.json({ error: "verification is not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // refuse rather than fall back: an unfunded or public test key produces verdicts that only look real
  if (!RELAY_KEY) {
    return NextResponse.json(
      { success: false, error: "verifier requires RELAY_PRIVATE_KEY: it signs the authorization, so the buyer must be funded" },
      { status: 500 },
    );
  }

  try {
    const { startedAt, outOfTime } = sweepBudget();
    // Fresh listings go first, capped per run so a listing flood cannot spend the
    // relay dry: at most three priority hires plus the score-ranked fill below.
    const { takeSweepQueue, loadVerifiedTokenIds } = await import("@/lib/verifications-store");
    const queued = await takeSweepQueue(3);
    const verifiedIds = await loadVerifiedTokenIds();
    const snapshotRes = await fetchJson(`${baseUrl()}/api/agents?limit=200&house=all`, {}, 45000);
    const agents = (snapshotRes.body?.items ?? []) as { token_id: number; name: string; category?: string; chain_id?: number }[];
    const candidates = mergeSweepCandidates(queued, agents, CHAIN_ID, VERIFY_LIMIT, verifiedIds);

    const { upsertVerification } = await import("@/lib/verifications-store");
    const results: { tokenId: string; name: string; status: string; responseMs: number; detail?: string }[] = [];
    // counted from the write results, so a sweep that cannot reach the store reports it instead of reading as done
    let persisted = 0;

    for (const cand of candidates) {
      if (outOfTime()) break;
      const t0 = Date.now();
      try {
        const verdict = await verifyAndRecord(cand);
        const ms = Date.now() - t0;
        if (verdict.persisted) persisted += 1;
        results.push({ tokenId: cand.tokenId, name: cand.name, status: verdict.status, responseMs: ms, detail: verdict.detail });
      } catch (e) {
        const ms = Date.now() - t0;
        const detail = `sweep error: ${(e as Error).message}`;
        if (await upsertVerification(cand.tokenId, cand.name, cand.category, "dead", ms, undefined, detail)) persisted += 1;
        results.push({ tokenId: cand.tokenId, name: cand.name, status: "dead", responseMs: ms, detail });
      }
    }

    const tally = { delivered: 0, gated: 0, dead: 0, unreachable: 0 };
    for (const r of results) tally[r.status as keyof typeof tally] += 1;

    return NextResponse.json({
      success: true,
      verified: results.length,
      persisted,
      budget: `${Math.round((Date.now() - startedAt) / 1000)}s`,
      tally,
      results,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
