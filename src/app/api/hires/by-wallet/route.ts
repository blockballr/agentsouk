import { NextRequest, NextResponse } from "next/server";
import { getPayment, listActiveSessions } from "@/lib/x402";
import { queryAgents } from "@/lib/scanner";

export const dynamic = "force-dynamic";

function sameAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet) {
    return NextResponse.json(
      { success: false, error: "wallet required" },
      { status: 400 },
    );
  }
  const sessions = listActiveSessions().filter((s) =>
    sameAddr(s.client, wallet),
  );
  const catalogue = await queryAgents({ limit: 5000 });
  const categoryByToken = new Map(
    catalogue.items.map((a) => [
      `${a.chain_id}:${a.token_id}`,
      a.category ?? "general",
    ]),
  );
  const hires = sessions.map((s) => {
    const stored = getPayment(s.paymentId);
    return {
      paymentId: s.paymentId,
      receiptId: s.paymentId,
      chainId: s.chainId,
      tokenId: s.tokenId,
      agentName: s.agentName,
      category: categoryByToken.get(`${s.chainId}:${s.tokenId}`) ?? null,
      client: s.client,
      txHash: stored?.txHash ?? null,
      mode: s.mode,
      spendCapUsd: s.spendCapUsd,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    };
  });
  return NextResponse.json({
    success: true,
    wallet,
    hires,
    counts: {
      hires: hires.length,
    },
  });
}
