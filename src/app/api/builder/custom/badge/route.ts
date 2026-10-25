import { NextRequest, NextResponse } from "next/server";
import { getCustomAgentByTokenId } from "@/lib/builder/custom";
import { escrowStatsForAgent } from "@/lib/jobs";
import { targetChainId } from "@/lib/types";
import type { CustomBadge } from "@/lib/builder/custom";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/custom/badge?tokenId=...&chainId=...
export async function GET(req: NextRequest): Promise<NextResponse> {
  const tokenId = req.nextUrl.searchParams.get("tokenId");
  if (!tokenId) return json({ success: false, error: "tokenId is required" }, 400);

  try {
    const agent = await getCustomAgentByTokenId(tokenId);
    if (!agent) return json({ success: true, ok: true, isCustom: false, badge: null }, 200);

    const chainId = Number(req.nextUrl.searchParams.get("chainId")) || targetChainId();

    let badge: CustomBadge = "new";
    const escrow = await escrowStatsForAgent(chainId, agent.onChainTokenId, agent.walletAddress).catch(() => ({ count: 0, days: 0, lastAt: null }));
    if (escrow.count >= 5 && escrow.days >= 3) badge = "established";

    return json({
      success: true,
      ok: true,
      isCustom: true,
      badge,
      agentId: agent.id,
      walletAddress: agent.walletAddress,
      online: agent.deployment?.ok === true,
      escrow: { actions: escrow.count, days: escrow.days, lastAt: escrow.lastAt },
    }, 200);
  } catch (e) {
    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "lookup failed" }, 503);
  }
}
