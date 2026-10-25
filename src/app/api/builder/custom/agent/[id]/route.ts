import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent } from "@/lib/builder/custom";
import { pickPublicOrigin } from "@/lib/house-agent";
import { readWalletActivity } from "@/lib/onchain-activity";
import { escrowStatsForAgent } from "@/lib/jobs";
import { targetChainId } from "@/lib/types";
import type { CustomBadge } from "@/lib/builder/custom";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/custom/agent/:id
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const agent = await getCustomAgent(id);
    if (!agent) return json({ success: false, ok: false, error: "not found" }, 404);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const endpoint = agent.deployment?.url ?? `${origin.replace(/\/+$/, "")}/api/built/${agent.id}/a2a`;

    const chainId = targetChainId();

    // badge is work proof from escrow job completions (not liveness).
    // availability (online/offline) is tracked separately and does NOT affect the badge.
    let badge: CustomBadge = "new";
    const escrow = await escrowStatsForAgent(chainId, agent.onChainTokenId, agent.walletAddress).catch(() => ({ count: 0, days: 0, lastAt: null }));
    if (escrow.count >= 5 && escrow.days >= 3) badge = "established";

    // availability is separate from verification badge
    const online = agent.deployment?.ok === true;

    return json({
      success: true,
      ok: true,
      id: agent.id,
      owner: agent.owner,
      manifest: agent.manifest,
      walletAddress: agent.walletAddress,
      badge,
      online,
      endpoint,
      deployment: agent.deployment,
      listingState: agent.deployment?.ok ? "listed" : "unlisted",
      escrow: { actions: escrow.count, days: escrow.days, lastAt: escrow.lastAt },
    }, 200);
  } catch (e) {
    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "lookup failed" }, 503);
  }
}
