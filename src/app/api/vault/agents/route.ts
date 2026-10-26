import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";
import { firstPartyBadges } from "@/lib/first-party-copy";

export const dynamic = "force-dynamic";

// GET /api/vault/agents?chain=97
// the agents that declare a vault hire on this chain, with the strategy each
// declared. the badge on a hire row and the sibling list on a vault agent page
// both read this, so neither repeats the rule or keeps its own copy of a name.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asked = Number(req.nextUrl.searchParams.get("chain"));
  const chainId = Number.isFinite(asked) && asked > 0 ? asked : targetChainId();

  const agents = firstPartyBadges(chainId)
    .filter((a) => a.vaultOnly)
    .sort((a, b) => Number(a.tokenId) - Number(b.tokenId));

  return NextResponse.json(
    { success: true, chainId, agents },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
