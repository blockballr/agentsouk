import { NextRequest, NextResponse } from "next/server";
import { listPaymentsByPayee, receiptsMode } from "@/lib/receipts-store";
import { settlementAsset } from "@/lib/types";

export const dynamic = "force-dynamic";

// Hires a wallet was paid for. A settlement records a payer (client) and a payee
// (payTo, the agent's receiving wallet); the by-wallet read answers the payer side,
// so a lister asking "did anyone hire me" reads this payee side of the same receipts.

export async function GET(req: NextRequest) {
  const payee = req.nextUrl.searchParams.get("payee")?.trim() ?? "";
  if (!payee) {
    return NextResponse.json(
      { success: false, error: "payee required" },
      { status: 400 },
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(payee)) {
    return NextResponse.json(
      { success: false, error: "payee must be an address" },
      { status: 400 },
    );
  }

  const body = await hiresForPayee(payee);
  return NextResponse.json(body);
}

async function hiresForPayee(payee: string) {
  // The durable read is the batch: one query returns every receipt paid to this
  // wallet, so the map below never reaches the store per payment.
  const stored = await listPaymentsByPayee(payee);
  const hires = stored.map((p) => {
    // a stored amount is raw base units; the settlement asset states the decimals,
    // so the page can show the figure the payer actually signed for
    let decimals: number | null = null;
    try {
      decimals = settlementAsset(p.agent.chainId).decimals;
    } catch {
      // an unconfigured chain leaves the amount unformatted rather than guessing
      decimals = null;
    }
    return {
      paymentId: p.paymentId,
      chainId: p.agent.chainId,
      tokenId: p.agent.tokenId,
      agentName: p.agent.name,
      client: p.client,
      payTo: p.payTo,
      txHash: p.txHash ?? null,
      mode: p.mode,
      amount: p.amount,
      symbol: p.symbol,
      decimals,
      active: p.activated,
      createdAt: p.createdAt,
    };
  });

  return {
    success: true,
    payee,
    hires,
    counts: {
      hires: hires.length,
    },
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  };
}
