import { NextRequest, NextResponse } from "next/server";
import { listPaymentsByClient, receiptsMode } from "@/lib/receipts-store";
import { queryAgents } from "@/lib/scanner";
import { CATEGORY_KEYS, type CategoryKey } from "@agora/core";

export const dynamic = "force-dynamic";

// The Set and Earn verdict for one wallet: which of the four categories it has
// hired in, what it has listed, and whether that completes the quest. A hire is
// counted only when it is the wallet's own, settled, non-excluded activity, so
// wash and team activity can never complete a wallet.

const TEAM_WALLETS = new Set(
  [
    "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4", // relay / broadcaster
    "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713", // buyer / authorizer
    "0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5", // declared agent identity
  ].map((a) => a.toLowerCase()),
);

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "wallet must be an address" }, { status: 400 });
  }
  const w = wallet.toLowerCase();

  const [payments, catalogue] = await Promise.all([
    listPaymentsByClient(wallet),
    queryAgents({ limit: 5000 }),
  ]);
  const byToken = new Map(catalogue.items.map((a) => [`${a.chain_id}:${a.token_id}`, a]));
  const isTeam = TEAM_WALLETS.has(w);

  const categories: Record<string, boolean> = {};
  for (const key of CATEGORY_KEYS) categories[key] = false;

  const hires = [];
  for (const p of payments) {
    if (!p.activated) continue;
    // the team's own activity and the verifier sweep are never a wallet's quest progress
    if (isTeam) continue;
    if (String(p.paymentId).startsWith("verify_")) continue;
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

  return NextResponse.json({
    success: true,
    wallet,
    categories,
    hiredAllFour,
    hires,
    listings,
    listedOne,
    completed: hiredAllFour && listedOne,
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  });
}
