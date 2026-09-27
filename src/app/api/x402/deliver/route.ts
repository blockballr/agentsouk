import { NextRequest, NextResponse } from "next/server";
import { deliver } from "@/lib/delivery";

export const dynamic = "force-dynamic";
// the agent call alone allows 20s, so the function needs room past the default
export const maxDuration = 60;

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

  if (!body?.paymentId) {
    return NextResponse.json({ success: false, error: "paymentId required" }, { status: 400 });
  }

  try {
    const outcome = await deliver({
      paymentId: body.paymentId,
      tool: body.tool,
      args: body.args,
      task: body.task,
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
