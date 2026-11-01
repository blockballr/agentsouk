import { NextRequest, NextResponse } from "next/server";
import { getPaymentDurable, receiptsMode } from "@/lib/receipts-store";
import { getAgentByToken } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function explorer(chainId: number, txHash: string): string {
  const host = chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
  return `${host}/tx/${txHash}`;
}

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get("paymentId")?.trim() ?? "";
  if (!paymentId) {
    return NextResponse.json(
      { data: null, error: "paymentId required", meta: { checkedAt: new Date().toISOString() } },
      { status: 400 },
    );
  }

  const payment = await getPaymentDurable(paymentId);
  if (!payment) {
    return NextResponse.json(
      {
        data: null,
        error: "no payment with that id",
        meta: { source: receiptsMode(), checkedAt: new Date().toISOString() },
      },
      { status: 404 },
    );
  }

  const agent = await getAgentByToken(payment.agent.chainId, payment.agent.tokenId).catch(() => null);
  const record = agent as { agent_wallet?: string | null; owner_address?: string | null } | null;
  const agentWallet = record?.agent_wallet ?? null;
  const agentOwner = record?.owner_address ?? null;
  const payeeMatchesAgent = agentWallet
    ? agentWallet.toLowerCase() === payment.payTo.toLowerCase()
    : null;
  const amount = Number(payment.amount) / 1e18;

  return NextResponse.json({
    data: {
      paymentId: payment.paymentId,
      chainId: payment.agent.chainId,
      tokenId: payment.agent.tokenId,
      agentName: payment.agent.name,
      agentOwner,
      agentWallet,
      client: payment.client,
      payee: payment.payTo,
      payeeMatchesAgent,
      amount: Number.isFinite(amount) ? amount : payment.amount,
      symbol: payment.symbol,
      mode: payment.mode,
      txHash: payment.txHash,
      explorer: payment.txHash ? explorer(payment.agent.chainId, payment.txHash) : null,
      settledAt: payment.createdAt,
      activated: payment.activated,
    },
    error: null,
    meta: { source: receiptsMode(), checkedAt: new Date().toISOString() },
  });
}
