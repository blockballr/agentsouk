import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken, queryAgents } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent, readsPancakeSwap } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";
import { sessionRevoked } from "@/lib/receipts-store";
import { getBoost, hydrateBoostsFromDb } from "@/lib/boosts";
import { fetchAgentCardSkills } from "@/lib/delivery";
import { readPancakePositions } from "@/lib/pancake-positions";

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
  // the wallet the agent registered, read for PancakeSwap v3 positions while the rest of the
  // page loads; never the owner's, whose personal activity is not the agent's
  const wallet = "agent_wallet" in agent ? agent.agent_wallet : null;
  const positions = readPancakePositions(Number(chainId), wallet);
  const verifications = await loadVerifications();
  await hydrateBoostsFromDb();
  const verification = verifications.get(agent.token_id);
  const skills =
    agent.skills ??
    (agent.a2a_endpoint
      ? ((await fetchAgentCardSkills(agent.a2a_endpoint, 4000)) ?? undefined)
      : undefined);
  // the shelf's category is the tab the listing sits under, which a re-read of its text can miss
  const shelved = (await queryAgents({ limit: 5000, includeHouse: true, includeDelisted: true })).items.find(
    (a) => a.token_id === agent.token_id,
  );
  const categorised = shelved?.category ? { ...agent, category: shelved.category } : agent;
  const data = verification ? { ...categorised, verification } : categorised;
  const withSkills = skills ? { ...data, skills } : data;
  const withPcs =
    readsPancakeSwap(Number(chainId), tokenId) || isPancakeSwapAgent(agent.name, agent.description ?? "")
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
  const held = await positions;
  // only positions that exist are shown; a failed read and an empty wallet both say nothing
  const withPositions = held && held.held + held.staked > 0 ? { ...withBoost, pancakeswapPositions: held } : withBoost;
  return NextResponse.json({
    data: activeSession ? { ...withPositions, activeSession } : withPositions,
  });
}
