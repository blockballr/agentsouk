import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { readLiveness } from "@/lib/liveness";

export const dynamic = "force-dynamic";

// GET /api/agents/[chainId]/[tokenId]/liveness
// a listing the sweep has never posted for reads as no reading, not a zero verdict
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId, tokenId } = await params;
  const parsed = Number(chainId);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return NextResponse.json({ error: "chainId must be a chain id" }, { status: 400 });
  }
  const agent = await getAgentByToken(parsed, tokenId);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }
  const reading = await readLiveness(parsed, agent.token_id);
  return NextResponse.json({ chainId: parsed, tokenId: agent.token_id, reading });
}
