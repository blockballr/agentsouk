import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { readWalletActivity } from "@/lib/onchain-activity";

export const dynamic = "force-dynamic";

// GET /api/agents/[chainId]/[tokenId]/activity
// The agent's own wallet, read against the chain: contract calls that look like
// work, the distinct days they landed, and whether that clears the listing
// standard (five actions on three days). Plain transfers, approvals, registry
// writes and ERC-8183 deliveries are excluded.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId, tokenId } = await params;
  const chain = Number(chainId);
  if (!Number.isSafeInteger(chain) || chain < 1) {
    return NextResponse.json({ success: false, error: "invalid chain" }, { status: 400 });
  }
  const agent = await getAgentByToken(chain, tokenId);
  if (!agent) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }
  const wallet = "agent_wallet" in agent ? agent.agent_wallet : null;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json(
      { success: false, error: "this listing names no receiving wallet, so there is nothing to read on chain" },
      { status: 409 },
    );
  }
  const activity = await readWalletActivity(chain, wallet);
  return NextResponse.json(
    { success: true, activity },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
