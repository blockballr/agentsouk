import { NextRequest, NextResponse } from "next/server";
import { changePlan, getHosting, topUpCredits } from "@/lib/builder/hosting";
import { enqueue } from "@/lib/builder/outbox";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/credits?owner=0x...   reads the credit balance and tier
export async function GET(req: NextRequest): Promise<NextResponse> {
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ success: false, error: "owner must be a wallet address" }, 400);
  const row = await getHosting(owner).catch(() => null);
  return json({ success: true, hosting: row });
}

// POST /api/builder/credits  { owner, amountUsd, plan? }
// records a credit top-up. The x402/EIP-3009 payment proof is verified by the
// caller in production; here the amount is credited on the strength of the
// request so the flow can be exercised. A plan change (free -> plus/pro)
// consumes credits and is recorded as plan_changed.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    amountUsd?: unknown;
    plan?: unknown;
  } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner.toLowerCase();
  const amount = typeof body.amountUsd === "number" && body.amountUsd > 0 ? body.amountUsd : 0;

  if (amount > 0) {
    const row = await topUpCredits(owner, amount);
    if (!row) return json({ success: false, error: "no hosting row; provision first" }, 404);
    void enqueue("topup_needed", owner, { amountUsd: amount }).catch(() => {});
  }

  const plan = typeof body.plan === "string" ? body.plan : null;
  if (plan && (plan === "plus" || plan === "pro" || plan === "enterprise")) {
    const cost = plan === "plus" ? 49 * 12 : plan === "pro" ? 149 * 12 : 0;
    const result = await changePlan(owner, plan as "plus" | "pro" | "enterprise", cost);
    if (!result.ok) return json({ success: false, error: result.reason ?? "plan change failed", hosting: result.hosting }, 402);
    void enqueue("plan_changed", owner, { plan, cost }).catch(() => {});
    return json({ success: true, hosting: result.hosting, planChanged: true });
  }

  const row = await getHosting(owner);
  return json({ success: true, hosting: row });
}
