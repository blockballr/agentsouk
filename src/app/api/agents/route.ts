import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { hydrateBoostsFromDb, isBoosted } from "@/lib/boosts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") ?? "all";
  const q = sp.get("q") ?? "";
  const sort = (sp.get("sort") as "score" | "newest" | "feedback" | "health") ?? "score";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit") ?? 24) || 24));
  const warm = sp.get("warm") === "1";
  const maxWarmPages = Math.min(12, Math.max(1, Number(sp.get("warmPages") ?? 6) || 6));
  const pcs = sp.get("pcs") === "1";

  const result = await queryAgents({
    category,
    q,
    sort,
    page,
    limit,
    ensureWarm: warm,
    maxWarmPages,
    pcs,
  });

  await hydrateBoostsFromDb();
  const verifications = await loadVerifications();

  // paid boosts sort first within the page the query already selected
  const ranked = [...result.items].sort((a, b) => {
    const ab = isBoosted(a.chain_id, a.token_id) ? 1 : 0;
    const bb = isBoosted(b.chain_id, b.token_id) ? 1 : 0;
    return bb - ab;
  });

  const items = ranked.map((a) => {
    const verification = verifications.get(a.token_id);
    const withPcs = isPancakeSwapAgent(a.name, a.description ?? "")
      ? { ...a, pcs: true }
      : a;
    const withVerification = verification ? { ...withPcs, verification } : withPcs;
    const activeSession = findActiveSession(a.chain_id, a.token_id);
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
    items,
  });
}
