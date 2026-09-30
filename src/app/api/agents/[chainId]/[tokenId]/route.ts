import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { sessionRevoked } from "@/lib/receipts-store";
import { getBoost, hydrateBoostsFromDb } from "@/lib/boosts";
import { fetchAgentCardSkills } from "@/lib/delivery";

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
  const skills =
    agent.skills ??
    (agent.a2a_endpoint
      ? ((await fetchAgentCardSkills(agent.a2a_endpoint, 4000)) ?? undefined)
      : undefined);
  const data = verification ? { ...agent, verification } : agent;
  const withSkills = skills ? { ...data, skills } : data;
  const withPcs = isPancakeSwapAgent(agent.name, agent.description ?? "")
    ? { ...withSkills, pcs: true }
    : withSkills;
  const found = findActiveSession(Number(chainId), tokenId);
  // a revoke recorded on another instance never reaches this ledger, so the
  // durable receipt decides whether the page is still offered run controls
  const activeSession = found && !(await sessionRevoked(found.paymentId)) ? found : undefined;
  const boost = getBoost(Number(chainId), tokenId);
  const withBoost = boost
    ? { ...withPcs, boosted: true, boostExpiresAt: boost.expiresAt }
    : withPcs;
  return NextResponse.json({
    data: activeSession ? { ...withBoost, activeSession } : withBoost,
  });
}
