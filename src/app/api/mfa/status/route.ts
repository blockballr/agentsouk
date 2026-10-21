import { NextRequest, NextResponse } from "next/server";
import { isMfaEnabled } from "@/lib/mfa-store";

export const dynamic = "force-dynamic";

// GET /api/mfa/status?wallet=0x...
// whether the authenticator is on for this wallet. Only the boolean leaves the
// server; the secret never does.
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "invalid wallet" }, { status: 400 });
  }
  const totpEnabled = await isMfaEnabled(wallet);
  return NextResponse.json({ success: true, totpEnabled });
}
