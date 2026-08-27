import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";

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
  return NextResponse.json({ data: agent });
}
