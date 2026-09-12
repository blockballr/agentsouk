import { NextRequest, NextResponse } from "next/server";
import { getBoost, hydrateBoostsFromDb, listActiveBoosts, recordBoost } from "@/lib/boosts";
import { evaluateBoostEligibility } from "@/lib/boost-eligibility";
import {
  boostAuthMessage,
  isAgentOwner,
  normalizeAddr,
  verifyBoostOwnership,
} from "@/lib/boost-auth";
import { getPaymentDurable } from "@/lib/receipts-store";
import { fetchAgentDetail } from "@/lib/scanner";
import { loadVerifications } from "@/lib/verifications";
import { notifyBoostReceipt } from "@/lib/notify";

export const dynamic = "force-dynamic";

// GET /api/boosts, active boosts or one boost + eligibility with chainId and tokenId.
// POST is an owner-only paid boost; the signature proves the registered owner authorized it and paymentId must be a settled session owned by that wallet.

const BOOST_SECRET = process.env.BOOST_SECRET;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

async function eligibilityFor(chainId: number, tokenId: string) {
  const detail = await fetchAgentDetail(chainId, tokenId);
  const verifications = await loadVerifications();
  const verification = verifications.get(tokenId) ?? null;
  return {
    detail,
    verification,
    ...evaluateBoostEligibility({ detail, verification }),
  };
}

export async function GET(req: NextRequest) {
  await hydrateBoostsFromDb();
  const chainId = Number(req.nextUrl.searchParams.get("chainId") ?? 56);
  const tokenId = req.nextUrl.searchParams.get("tokenId");

  if (tokenId) {
    const boost = getBoost(chainId, tokenId);
    const elig = await eligibilityFor(chainId, tokenId);
    return NextResponse.json({
      success: true,
      boost: boost ?? null,
      eligible: elig.eligible,
      checks: elig.checks,
      missing: elig.missing,
      owners: [
        elig.detail?.owner_address,
        elig.detail?.agent_wallet,
      ].filter(Boolean),
    });
  }
  return NextResponse.json({ success: true, boosts: listActiveBoosts() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: number;
    tokenId?: string;
    days?: number;
    paymentId?: string;
    contact?: string;
    secret?: string;
    owner?: string;
    signature?: string;
    nonce?: string;
  } | null;

  const chainId = Number(body?.chainId ?? 56);
  const tokenId = body?.tokenId?.trim();
  if (!tokenId) {
    return NextResponse.json({ success: false, error: "tokenId required" }, { status: 400 });
  }

  const elig = await eligibilityFor(chainId, tokenId);
  if (!elig.eligible) {
    return NextResponse.json(
      {
        success: false,
        error: "Boost is gated on the verifier checklist. Fix these first.",
        missing: elig.missing,
        checks: elig.checks,
      },
      { status: 403 },
    );
  }

  const days = Math.max(1, Math.min(MAX_DAYS, Number(body?.days ?? DEFAULT_DAYS) || DEFAULT_DAYS));
  const authorizedBySecret = Boolean(BOOST_SECRET && body?.secret === BOOST_SECRET);

  // operator path skips wallet ownership; public path requires the agent owner
  if (!authorizedBySecret) {
    const owner = body?.owner?.trim();
    const signature = body?.signature?.trim();
    const nonce = body?.nonce?.trim();
    if (!owner || !signature || !nonce) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Boost requires an owner signature. Connect the wallet that owns this agent, sign the boost message, then pay.",
        },
        { status: 401 },
      );
    }
    if (!isAgentOwner(owner, elig.detail)) {
      return NextResponse.json(
        {
          success: false,
          error: "Connected wallet is not the registered owner or agent wallet for this listing.",
        },
        { status: 403 },
      );
    }
    const expectedOwner = isAgentOwner(owner, {
      owner_address: elig.detail?.owner_address ?? null,
      agent_wallet: null,
    })
      ? (elig.detail?.owner_address ?? owner)
      : (elig.detail?.agent_wallet ?? owner);

    const message = boostAuthMessage({
      chainId,
      tokenId,
      owner: normalizeAddr(expectedOwner),
      days,
      nonce,
    });
    const sig = await verifyBoostOwnership({
      message,
      signature,
      expectedOwner,
    });
    if (!sig.ok) {
      return NextResponse.json(
        { success: false, error: sig.error ?? "owner signature invalid" },
        { status: 401 },
      );
    }

    if (!body?.paymentId) {
      return NextResponse.json(
        {
          success: false,
          error: "Settled x402 paymentId required. Hire once as the owner, then boost with that receipt.",
        },
        { status: 402 },
      );
    }
    const receipt = await getPaymentDurable(body.paymentId);
    if (!receipt?.activated) {
      return NextResponse.json(
        { success: false, error: "paymentId is not a settled session" },
        { status: 402 },
      );
    }
    if (!isAgentOwner(receipt.client, elig.detail)) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment was not settled by the agent owner. Boost payment must come from the owner wallet.",
        },
        { status: 403 },
      );
    }
  }

  const agentName = elig.detail?.name ?? `Agent ${tokenId}`;

  const boost = await recordBoost({
    chainId,
    tokenId,
    agentName,
    days,
    paymentId: body?.paymentId,
    contact: body?.contact,
  });

  await notifyBoostReceipt({
    tokenId,
    agentName,
    days,
    expiresAt: boost.expiresAt,
    contact: body?.contact,
  });

  return NextResponse.json({ success: true, boost, checks: elig.checks });
}
