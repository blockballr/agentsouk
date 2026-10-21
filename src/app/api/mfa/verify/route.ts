import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { getMfaSecret, setMfaEnabled } from "@/lib/mfa-store";
import { verifyTotp } from "@/lib/mfa";

export async function POST(req: NextRequest) {
  let wallet = "";
  let code = "";
  let message = "";
  let signature = "";
  try {
    const body = await req.json();
    wallet = String(body?.wallet ?? "");
    code = String(body?.code ?? "");
    message = String(body?.message ?? "");
    signature = String(body?.signature ?? "");
  } catch {
    return NextResponse.json({ success: false, error: "bad request" }, { status: 400 });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "invalid wallet" }, { status: 400 });
  }
  if (!message || !signature) {
    return NextResponse.json({ success: false, error: "missing signature" }, { status: 400 });
  }
  const valid = await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` });
  if (!valid) {
    return NextResponse.json({ success: false, error: "invalid signature" }, { status: 401 });
  }
  const secret = await getMfaSecret(wallet);
  if (!secret) {
    return NextResponse.json({ success: false, error: "not enrolled" }, { status: 404 });
  }
  const ok = verifyTotp(secret, code);
  if (ok) await setMfaEnabled(wallet, true);
  return NextResponse.json({ success: ok });
}
