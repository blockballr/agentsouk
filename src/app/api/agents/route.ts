import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { revokedAmong } from "@/lib/receipts-store";
import { hydrateBoostsFromDb, isBoosted } from "@/lib/boosts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") ?? "all";
  const q = sp.get("q") ?? "";
  const sort = (sp.get("sort") as "score" | "newest" | "feedback" | "health" | "reachability") ?? "reachability";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit") ?? 24) || 24));
  const warm = sp.get("warm") === "1";
  const maxWarmPages = Math.min(12, Math.max(1, Number(sp.get("warmPages") ?? 6) || 6));
  const pcs = sp.get("pcs") === "1";

  const verifications = await loadVerifications();

  const result = await queryAgents({
    category,
    q,
    sort,
    page,
    limit,
    ensureWarm: warm,
    maxWarmPages,
    pcs,
    verifications,
  });

  await hydrateBoostsFromDb();

  // paid boosts sort first within the page the query already selected
  const ranked = [...result.items].sort((a, b) => {
    const ab = isBoosted(a.chain_id, a.token_id) ? 1 : 0;
    const bb = isBoosted(b.chain_id, b.token_id) ? 1 : 0;
    return bb - ab;
  });

  // the detail route asks the same durable question, so a revoke recorded
  // elsewhere cannot leave a dead session showing live on the shelf
  const sessions = ranked.map((a) => findActiveSession(a.chain_id, a.token_id));
  const revoked = await revokedAmong(sessions.flatMap((s) => (s ? [s.paymentId] : [])));

  const items = ranked.map((a, i) => {
    const verification = verifications.get(a.token_id);
    const withPcs = isPancakeSwapAgent(a.name, a.description ?? "")
      ? { ...a, pcs: true }
      : a;
    const withVerification = verification ? { ...withPcs, verification } : withPcs;
    const found = sessions[i];
    const activeSession = found && !revoked.has(found.paymentId) ? found : undefined;
    const withSession = activeSession
      ? { ...withVerification, activeSession }
      : withVerification;
    return isBoosted(a.chain_id, a.token_id) ? { ...withSession, boosted: true } : withSession;
  });

  return NextResponse.json({
    success: true,
    // state the chain this catalogue is served on, so a client never has to guess it
    chainId: targetChainId(),
    ...result,
    // the catalogue's own freshness rides in indexStatus: catalogueRefreshedAt is
    // the shared store's refresh time (null when unknown) and catalogueSource says
    // whether the store or the committed snapshot is serving
    indexStatus: result.indexStatus,
    items,
    // the proof strip reads both: snapshotTotal is how many agents the committed
    // snapshot holds, registryTotal how many the registry reports for this chain
    // (null when the snapshot never recorded one), and the timestamps are the
    // freshness the server can actually attest
    snapshotTotal: result.indexStatus.snapshotTotal,
    registryTotal: result.indexStatus.registryTotal,
    counts: result.categoryCounts,
    snapshotTime: result.indexStatus.snapshotTime,
    lastTopUpAt: result.indexStatus.lastTopUpAt,
  });
}
