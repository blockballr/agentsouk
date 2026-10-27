import { NextRequest, NextResponse } from "next/server";
import { listRecentPayments, receiptsMode } from "@/lib/receipts-store";
import { isVerifierPayment } from "@/lib/team-wallets";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// The market's own last settled hires, newest first. The shelf says what can be
// hired; this says what was, so the page carries evidence rather than adjectives.
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? "6");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 20) : 6;
  const chainId = targetChainId();
  try {
    const rows = (await listRecentPayments(200))
      .filter((p) => (p.mode === "prod" || p.mode === "b402") && p.agent.chainId === chainId && !isVerifierPayment(p.paymentId))
      .slice(0, limit)
      .map((p) => ({
        at: p.createdAt,
        agentName: p.agent.name,
        tokenId: p.agent.tokenId,
        chainId: p.agent.chainId,
        rail: p.mode === "b402" ? "x402" : "escrow",
        amount: settledAmount(p.amount),
        symbol: p.symbol,
        txHash: p.txHash ?? null,
      }));
    return NextResponse.json({ success: true, source: receiptsMode(), items: rows });
  } catch (e) {
    return NextResponse.json(
      { success: false, items: [], error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}

// the settlements are all 18-decimal stables, so one division covers them. an
// amount that is not a whole wei string is shown as it came rather than guessed at
function settledAmount(raw: string): string {
  try {
    const value = Number(BigInt(raw)) / 1e18;
    if (!Number.isFinite(value)) return raw;
    if (value === 0) return "0";
    return value < 1 ? value.toFixed(4) : value.toFixed(2);
  } catch {
    return raw;
  }
}
