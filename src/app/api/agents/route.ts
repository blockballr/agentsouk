import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";

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

  const verifications = await loadVerifications();
  const items = result.items.map((a) => {
    const verification = verifications.get(a.token_id);
    const withPcs = isPancakeSwapAgent(a.name, a.description ?? "")
      ? { ...a, pcs: true }
      : a;
    const withVerification = verification ? { ...withPcs, verification } : withPcs;
    const activeSession = findActiveSession(a.chain_id, a.token_id);
    return activeSession ? { ...withVerification, activeSession } : withVerification;
  });

  return NextResponse.json({
    success: true,
    ...result,
    items,
  });
}