import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { isPancakeSwapAgent } from "@/lib/pancakeswap";
import { findActiveSession } from "@/lib/x402";

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
  const verification = verifications.get(agent.token_id);
  const data = verification ? { ...agent, verification } : agent;
  const withPcs = isPancakeSwapAgent(agent.name, agent.description ?? "");
  const activeSession = findActiveSession(Number(chainId), tokenId);
  const payload = withPcs ? { ...data, pcs: true } : data;
  return NextResponse.json({
    data: activeSession ? { ...payload, activeSession } : payload,
  });
}
