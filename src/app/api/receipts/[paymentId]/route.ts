import { NextRequest, NextResponse } from "next/server";
import { getPaymentDurable } from "@/lib/receipts-store";

export const dynamic = "force-dynamic";

// GET /api/receipts/[paymentId]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  const payment = await getPaymentDurable(paymentId);
  if (!payment) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  return NextResponse.json(payment);
}
