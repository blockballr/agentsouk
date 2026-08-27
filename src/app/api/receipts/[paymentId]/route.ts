import { NextRequest, NextResponse } from "next/server";
import { getPayment } from "@/lib/x402";

export const dynamic = "force-dynamic";

// GET /api/receipts/[paymentId]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const payment = getPayment(paymentId);
  if (!payment) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  return NextResponse.json(payment);
}
