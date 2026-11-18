import { NextRequest, NextResponse } from "next/server";
import { agentIdHoldersAmong } from "@/lib/agent-id";

export const dynamic = "force-dynamic";

// GET /api/agent-id/holders?wallets=0x..,0x.. - which of up to 100 seller wallets hold a Binance
// Agent ID, for the holder badge on listings. it answers yes or no only and never returns a name
export async function GET(req: NextRequest) {
  const wallets = (req.nextUrl.searchParams.get("wallets") ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  if (wallets.length === 0 || wallets.length > 100) {
    return NextResponse.json({ success: false, error: "pass 1 to 100 wallets" }, { status: 400 });
  }
  const holders = await agentIdHoldersAmong(wallets).catch(() => null);
  if (!holders) return NextResponse.json({ success: false, error: "could not read Agent ID right now" }, { status: 502 });
  return NextResponse.json({ success: true, holders }, { headers: { "cache-control": "public, max-age=600" } });
}
