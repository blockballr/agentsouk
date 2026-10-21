import { NextRequest, NextResponse } from "next/server";
import { HOUSE_OPERATOR } from "@/lib/house";
import { changePlan, getHosting, topUpCredits } from "@/lib/builder/hosting";
import { enqueue } from "@/lib/builder/outbox";
import { settleSandbox, settleProd } from "@/lib/facilitator";
import { resolveFacilitatorMode } from "@/lib/facilitator-mode";
import { type PaymentPayload, type PaymentRequirements } from "@/lib/x402";
import { settlementAsset, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

function billingWallet(): string {
  return process.env.BUILDER_BILLING_WALLET ?? HOUSE_OPERATOR;
}

// GET /api/builder/credits?owner=0x...            -> balance + tier
// GET /api/builder/credits?owner=0x...&amountUsd=5 -> terms (paymentRequirements) to sign
export async function GET(req: NextRequest): Promise<NextResponse> {
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ success: false, error: "owner must be a wallet address" }, 400);

  const amountUsd = Number(req.nextUrl.searchParams.get("amountUsd") ?? "");
  if (Number.isFinite(amountUsd) && amountUsd > 0) {
    const chainId = targetChainId();
    const asset = settlementAsset(chainId);
    const payTo = billingWallet();
    const amount = (amountUsd * 10 ** asset.decimals).toString();
    const pr: PaymentRequirements = {
      scheme: "exact",
      network: `eip155:${chainId}`,
      amount,
      asset: asset.address,
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: asset.eip712Name, version: asset.eip712Version, assetTransferMethod: "eip3009" },
    };
    return json({ success: true, terms: pr });
  }

  const row = await getHosting(owner).catch(() => null);
  return json({ success: true, hosting: row });
}

// POST /api/builder/credits  { owner, paymentPayload, paymentRequirements, plan? }
// verifies the EIP-3009 authorization (same rails as a hire), then credits the
// row. A plan change consumes credits and is recorded as plan_changed.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    paymentPayload?: unknown;
    paymentRequirements?: unknown;
    plan?: unknown;
  } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner.toLowerCase();

  const plan = typeof body.plan === "string" ? body.plan : null;

  // credit top-up path: verify the payment proof, then credit
  if (body.paymentPayload && body.paymentRequirements) {
    const pr = body.paymentRequirements as PaymentRequirements;
    const pp = body.paymentPayload as PaymentPayload;
    if (pr.payTo?.toLowerCase() !== billingWallet().toLowerCase()) {
      return json({ success: false, error: "payment does not go to the billing wallet" }, 400);
    }
    const mode = resolveFacilitatorMode(process.env.FACILITATOR_MODE);
    const settle = mode === "sandbox" ? settleSandbox : settleProd;
    const result = await settle({ paymentPayload: pp, paymentRequirements: pr }, { agent: { chainId: targetChainId(), tokenId: "credits", name: "Builder Credits" } });
    if (!result.success) {
      return json({ success: false, error: result.error ?? "payment verification failed" }, 402);
    }
    const amountUsd = Number(pr.amount) / 10 ** 18;
    const row = await topUpCredits(owner, amountUsd);
    if (!row) return json({ success: false, error: "no hosting row; provision first" }, 404);
    void enqueue("topup_needed", owner, { amountUsd }).catch(() => {});
    // plan change after top-up
    if (plan && (plan === "plus" || plan === "pro" || plan === "enterprise")) {
      const cost = plan === "plus" ? 49 * 12 : plan === "pro" ? 149 * 12 : 0;
      const r = await changePlan(owner, plan as "plus" | "pro" | "enterprise", cost);
      if (!r.ok) return json({ success: false, error: r.reason ?? "plan change failed", hosting: r.hosting }, 402);
      void enqueue("plan_changed", owner, { plan, cost }).catch(() => {});
      return json({ success: true, hosting: r.hosting, planChanged: true, verified: true });
    }
    return json({ success: true, hosting: row, verified: true });
  }

  // plan-only change (no payment): consumes existing credits
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
