import { NextRequest, NextResponse } from "next/server";
import { agentIdOf } from "@/lib/agent-id";
import { proofFromHeaders, verifyWalletProof } from "@/lib/wallet-proof";

export const dynamic = "force-dynamic";

// GET /api/agent-id/me?wallet=0x.. - the signed-in wallet's own Agent ID. Only the wallet itself may
// ask, with its signed sign-in, so this can never be used to look up someone else's name.
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "wallet required" }, { status: 400 });
  }
  const { message, signature } = proofFromHeaders(req.headers);
  if (!(await verifyWalletProof({ wallet, message, signature }))) {
    return NextResponse.json({ success: false, error: "sign in with this wallet to read its Agent ID" }, { status: 401 });
  }
  const id = await agentIdOf(wallet);
  return NextResponse.json(
    { success: true, holder: id.holder, name: id.handle ? `${id.handle}.ai` : null },
    { headers: { "cache-control": "no-store" } },
  );
}
