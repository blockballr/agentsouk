import { NextRequest, NextResponse } from "next/server";
import { proofFromHeaders, verifyWalletProof } from "@/lib/wallet-proof";

export const dynamic = "force-dynamic";

// the website's Telegram delivery settings for one wallet. the caller proves it holds the wallet
// with its signed sign-in, then this asks the bot, which keeps the links, with the shared secret
//   GET    ?wallet=0x..  whether a chat is linked, and its name
//   POST   {wallet}      a one-time t.me link that links the chat that opens it
//   DELETE ?wallet=0x..  remove the link

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function proven(req: NextRequest, wallet: string | null): Promise<string | null> {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  const { message, signature } = proofFromHeaders(req.headers);
  return (await verifyWalletProof({ wallet, message, signature })) ? wallet : null;
}

async function askBot(wallet: string, action: "start" | "status" | "unlink"): Promise<NextResponse> {
  const secret = process.env.ASSISTANT_SECRET?.trim();
  if (!secret) return json({ success: false, error: "Telegram delivery is not configured" }, 503);
  const base = process.env.TELEGRAM_SERVICE_URL ?? "https://agentsouk-telegram.vercel.app";
  try {
    const res = await fetch(`${base}/telegram/wallet-link`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-assistant-secret": secret },
      body: JSON.stringify({ wallet, action }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body?.ok) return json({ success: false, error: "the Telegram service did not answer" }, 502);
    const { ok: _ok, ...rest } = body;
    return json({ success: true, ...rest });
  } catch {
    return json({ success: false, error: "the Telegram service did not answer" }, 502);
  }
}

const REFUSED = { success: false, error: "sign in with this wallet to manage its alerts" };

export async function GET(req: NextRequest) {
  const wallet = await proven(req, req.nextUrl.searchParams.get("wallet"));
  return wallet ? askBot(wallet, "status") : json(REFUSED, 401);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { wallet?: unknown } | null;
  const wallet = await proven(req, typeof body?.wallet === "string" ? body.wallet : null);
  return wallet ? askBot(wallet, "start") : json(REFUSED, 401);
}

export async function DELETE(req: NextRequest) {
  const wallet = await proven(req, req.nextUrl.searchParams.get("wallet"));
  return wallet ? askBot(wallet, "unlink") : json(REFUSED, 401);
}
