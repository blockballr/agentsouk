import { NextRequest, NextResponse } from "next/server";
import { loadProfile, saveProfile } from "@/lib/profile-store";
import { proofFromHeaders, verifyWalletProof } from "@/lib/wallet-proof";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

function isWallet(w: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(w);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> },
): Promise<NextResponse> {
  const { wallet } = await params;
  if (!isWallet(wallet)) return json({ success: false, error: "wallet required" }, 400);
  const profile = await loadProfile(wallet);
  if (!profile) return json({ success: true, ok: true, profile: null });
  return json({ success: true, ok: true, profile });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ wallet: string }> }): Promise<NextResponse> {
  const { wallet } = await params;
  if (!isWallet(wallet)) return json({ success: false, error: "wallet required" }, 400);
  // only the wallet itself may change its name and picture: the caller replays its signed sign-in
  const { message, signature } = proofFromHeaders(req.headers);
  if (!(await verifyWalletProof({ wallet, message, signature }))) {
    return json({ success: false, error: "sign in with this wallet to change its profile" }, 401);
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ success: false, error: "body required" }, 400);
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 32) : "";
  const avatar = typeof body.avatar === "string" ? body.avatar.trim().slice(0, 200000) : "";
  const saved = await saveProfile(wallet, username, avatar);
  if (!saved) return json({ success: false, error: "profile store unavailable" }, 503);
  return json({ success: true, ok: true, profile: saved });
}