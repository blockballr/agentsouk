import { NextRequest, NextResponse } from "next/server";
import { deliver } from "@/lib/delivery";

export const dynamic = "force-dynamic";

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
}
