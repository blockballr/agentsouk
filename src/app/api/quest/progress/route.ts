import { NextRequest, NextResponse } from "next/server";
import { listPaymentsByClient, receiptsMode } from "@/lib/receipts-store";
import { queryAgents } from "@/lib/scanner";
import { CATEGORY_KEYS, type CategoryKey } from "@agora/core";
import { isTeamWallet, isVerifierPayment } from "@/lib/team-wallets";
import { questAwards } from "@/lib/quest-points";

export const dynamic = "force-dynamic";

// The Set and Earn verdict for one wallet: which of the four categories it has
// hired in, what it has listed, and whether that completes the quest. A hire is
// counted only when it is the wallet's own, settled, non-excluded activity, so
// wash and team activity can never complete a wallet.

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "wallet must be an address" }, { status: 400 });
  }
  const w = wallet.toLowerCase();

  // a stamp once earned stays: an agent that has since left the shelf still counts, both
  // as a hire and as a listing, so the whole catalogue is read and not only what is on show
  const [payments, catalogue] = await Promise.all([
    listPaymentsByClient(wallet),
    queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true }),
  ]);
  const byToken = new Map(catalogue.items.map((a) => [`${a.chain_id}:${a.token_id}`, a]));
  const isTeam = isTeamWallet(w);

  const categories: Record<string, boolean> = {};
  for (const key of CATEGORY_KEYS) categories[key] = false;

  const hires = [];
  for (const p of payments) {
    // a revoked hire still counts: the payment settled, and revoking is part of the quest
    // the team's own activity and the verifier sweep are never a wallet's quest progress
    if (isTeam) continue;
    if (isVerifierPayment(p.paymentId)) continue;
    // sandbox moves no funds, so it is not a settlement
    if (p.mode !== "prod" && p.mode !== "b402") continue;
    const key = `${p.agent.chainId}:${p.agent.tokenId}`;
    const agent = byToken.get(key);
    // a wallet hiring an agent it owns is a self hire, excluded
    if (agent?.owner_address?.toLowerCase() === w) continue;
    const category = (agent?.category as string | undefined) ?? null;
    hires.push({
      paymentId: p.paymentId,
      tokenId: p.agent.tokenId,
      agentName: p.agent.name,
      category,
      txHash: p.txHash ?? null,
      mode: p.mode,
      createdAt: p.createdAt,
    });
    if (category && CATEGORY_KEYS.includes(category as CategoryKey)) categories[category] = true;
  }

  const listings = catalogue.items
    .filter((a) => a.owner_address?.toLowerCase() === w)
    .map((a) => ({
      tokenId: a.token_id,
      name: a.name,
      category: a.category ?? "general",
    }));

  const hiredAllFour = CATEGORY_KEYS.every((k) => categories[k]);
  const listedOne = listings.length > 0;
  const { points, awards } = questAwards(hires, CATEGORY_KEYS, listedOne);

  return NextResponse.json({
    success: true,
    wallet,
    categories,
    hiredAllFour,
    hires,
    listings,
    listedOne,
    completed: hiredAllFour && listedOne,
    points,
    awards,
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  });
}
