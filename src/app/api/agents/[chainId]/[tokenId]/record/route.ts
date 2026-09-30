import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loadTrackRecord } from "@/lib/track-record";

export const dynamic = "force-dynamic";

// GET /api/agents/[chainId]/[tokenId]/record - what the marketplace observed of one agent
// the owner is read from the shelf rather than taken from the caller, so a self hire
// cannot be counted by naming someone else as the owner
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "unsupported chain" }, { status: 400 });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400 });
  }
  const shelf = await queryAgents({ limit: 5000 });
  const owner = shelf.items.find((a) => a.token_id === tokenId)?.owner_address ?? null;
  const record = await loadTrackRecord(chainId, tokenId, owner);
  return NextResponse.json({ success: true, record });
}
