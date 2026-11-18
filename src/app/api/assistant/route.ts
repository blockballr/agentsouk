import { NextRequest, NextResponse } from "next/server";
import { assistantTurn } from "@/lib/assistant/run";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/assistant {message, conversation?, wallet?} - the web door to the Souk Assistant.
// it reads and prepares only; any action comes back as a link the user confirms in their wallet

const LIMIT = { table: "rate_assistant_web", limit: 6, windowMs: 60_000 };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { message?: unknown; conversation?: unknown; wallet?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ success: false, error: "say something" }, { status: 400 });
  const ip = clientIpFrom(req.headers);
  const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${ip}`] }).catch(() => ({ allowed: true, retryAfterSeconds: 0 }));
  if (!verdict.allowed) {
    return NextResponse.json({ success: false, error: `Too many messages. Try again in ${verdict.retryAfterSeconds} seconds.` }, { status: 429 });
  }
  const conversation = typeof body?.conversation === "string" && /^[a-z0-9-]{8,64}$/i.test(body.conversation) ? `web:${body.conversation}` : `web:ip:${ip}`;
  const wallet = typeof body?.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(body.wallet) ? body.wallet : null;
  const { text, actions } = await assistantTurn(conversation, message, wallet);
  return NextResponse.json({ success: true, reply: text, actions });
}
