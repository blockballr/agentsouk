import { NextRequest, NextResponse } from "next/server";
import { deliver } from "@/lib/delivery";
import { enforceRateLimit, type RateLimitVerdict } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// the agent call alone allows 20s, so the function needs room past the default
export const maxDuration = 60;

// A settled session is normally delivered once; a failed run adds at most three
// retries, so twenty an hour per payment bounds an id holder without touching
// the real flow. Keyed on the payment id, not the ip, because the authorized
// verify cron drives many distinct payments through one process.
const DELIVER_RATE = {
  table: "x402_deliver_rate_limits",
  limit: 20,
  windowMs: 60 * 60 * 1000,
};

// POST /api/x402/deliver
// gated on a settled hire: the receipt from /api/x402/settle unlocks invoking
// the agent's own endpoint and returning its deliverable
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    paymentId?: string;
    tool?: string;
    args?: Record<string, unknown>;
    task?: string;
  } | null;

  const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";
  if (!paymentId) {
    return NextResponse.json({ success: false, error: "paymentId required" }, { status: 400 });
  }

  // cap the outbound agent calls before any work starts; an unreachable store is
  // a refusal, not a fallthrough
  let rate: RateLimitVerdict;
  try {
    rate = await enforceRateLimit(DELIVER_RATE, {
      keys: [`payment:${paymentId.slice(0, 128)}`],
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Delivery is temporarily unavailable, please try again shortly." },
      { status: 503 },
    );
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many delivery attempts for this payment. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const outcome = await deliver({
      paymentId,
      tool: body?.tool,
      args: body?.args,
      task: body?.task,
    });

    if (!outcome.ok) {
      return NextResponse.json({ success: false, error: outcome.error }, { status: 402 });
    }

    return NextResponse.json({ success: true, data: outcome });
  } catch (e) {
    // an uncaught throw reaches the browser as an empty body, which a client
    // parsing json reports as "Unexpected end of JSON input". Answer in json.
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: `delivery failed: ${message}` },
      { status: 500 },
    );
  }
}
