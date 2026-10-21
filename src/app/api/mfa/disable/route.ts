import { NextRequest, NextResponse } from "next/server";
import { setMfaEnabled } from "@/lib/mfa-store";
import { verifyWalletProof } from "@/lib/mfa-request";

export const dynamic = "force-dynamic";

// POST /api/mfa/disable { wallet, message, signature }
// Turning the authenticator off is a sensitive action: it needs the wallet's own
// signature, so a session or a leaked URL cannot remove the second factor.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    message?: string;
    signature?: string;
  } | null;

  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const message = typeof body?.message === "string" ? body.message : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "invalid wallet" }, { status: 400 });
  }
  if (!(await verifyWalletProof(wallet, message, signature))) {
    return NextResponse.json({ success: false, error: "invalid signature" }, { status: 401 });
  }

  const totpDisabled = await setMfaEnabled(wallet, false);
  return NextResponse.json({ success: true, totpDisabled });
}
