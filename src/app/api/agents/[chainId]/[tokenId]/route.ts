import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { getBoost, hydrateBoostsFromDb } from "@/lib/boosts";

export const dynamic = "force-dynamic";

// GET /api/agents/[chainId]/[tokenId]
// fresh registry fetch with snapshot fallback, served to the Vite app

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId, tokenId } = await params;
  const agent = await getAgentByToken(Number(chainId), tokenId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }
  const verifications = await loadVerifications();
  await hydrateBoostsFromDb();
  const verification = verifications.get(agent.token_id);
  const data = verification ? { ...agent, verification } : agent;
  const withPcs = isPancakeSwapAgent(agent.name, agent.description ?? "")
    ? { ...data, pcs: true }
    : data;
  const activeSession = findActiveSession(Number(chainId), tokenId);
  const boost = getBoost(Number(chainId), tokenId);
  const withBoost = boost
    ? { ...withPcs, boosted: true, boostExpiresAt: boost.expiresAt }
    : withPcs;
  return NextResponse.json({
    data: activeSession ? { ...withBoost, activeSession } : withBoost,
  });
}
