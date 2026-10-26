import { NextRequest, NextResponse } from "next/server";
import { receiptsForHire, receiptsForAgent } from "@/lib/receipt-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/vault/receipts?chainId=97&hireId=16  -> receipts for a hire
// GET /api/vault/receipts?agent=0x...            -> receipts for an agent
export async function GET(req: NextRequest): Promise<NextResponse> {
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || 97;
  const hireId = req.nextUrl.searchParams.get("hireId");
  const agent = req.nextUrl.searchParams.get("agent");

  if (hireId) {
    const receipts = await receiptsForHire(chainId, hireId);
    return json({ success: true, ok: true, receipts });
  }
  if (agent) {
    const receipts = await receiptsForAgent(agent);
    return json({ success: true, ok: true, receipts });
  }
  return json({ success: false, ok: false, error: "hireId or agent is required" }, 400);
}
