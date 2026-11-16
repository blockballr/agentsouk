import { NextRequest, NextResponse } from "next/server";
import { firstPartyBadges } from "@/lib/first-party-copy";
import { buildProofFeed, settledAmount, type HireRow } from "@/lib/proof-feed";
import { recentReceipts } from "@/lib/receipt-store";
import { listRecentPayments } from "@/lib/receipts-store";
import { isVerifierPayment } from "@/lib/team-wallets";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/proof/feed?limit=20&tokenId=404603
// confirmed actions across the market, newest first, each with its transaction
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;
  const tokenId = req.nextUrl.searchParams.get("tokenId");
  const chainId = targetChainId();

  // each source fails on its own, so one outage leaves the others standing
  const [payments, receipts] = await Promise.all([
    listRecentPayments(300).catch(() => null),
    recentReceipts(chainId, 300).catch(() => null),
  ]);

  const hires: HireRow[] = (payments ?? [])
    .filter((p) => (p.mode === "prod" || p.mode === "b402") && p.agent.chainId === chainId && !isVerifierPayment(p.paymentId))
    .map((p) => ({
      at: p.createdAt,
      agentName: p.agent.name,
      tokenId: String(p.agent.tokenId),
      amount: settledAmount(p.amount),
      symbol: p.symbol,
      txHash: p.txHash ?? null,
    }));

  const items = buildProofFeed({
    hires,
    trades: receipts ?? [],
    agents: firstPartyBadges(chainId),
    limit,
    tokenId: tokenId && /^\d+$/.test(tokenId) ? tokenId : null,
  });

  return NextResponse.json(
    {
      success: true,
      chainId,
      items,
      // a source that could not be read is named, so an empty feed is never mistaken for a quiet market
      unavailable: [payments === null ? "hires" : null, receipts === null ? "vault trades" : null].filter(Boolean),
    },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
