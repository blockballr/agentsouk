import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { enrolMfa } from "@/lib/mfa-store";
import { otpauthUri } from "@/lib/mfa";
import QRCode from "qrcode";

export async function POST(req: NextRequest) {
  let wallet = "";
  let message = "";
  let signature = "";
  try {
    const body = await req.json();
    wallet = String(body?.wallet ?? "");
    message = String(body?.message ?? "");
    signature = String(body?.signature ?? "");
  } catch {
    wallet = "";
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
  const secret = await enrolMfa(wallet);
  if (!secret) {
    return NextResponse.json({ success: false, error: "store unavailable" }, { status: 503 });
  }
  const uri = otpauthUri(secret, wallet);
  const qrDataUrl = await QRCode.toDataURL(uri);
  return NextResponse.json({ success: true, secret, otpauthUri: uri, qrDataUrl });
}
