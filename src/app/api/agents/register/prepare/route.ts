import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { targetChainId } from "@/lib/types";
import {
  encodeRegister,
  registrationUrl,
  registryAddress,
  validateDraft,
  type RegistrationDraft,
} from "@/lib/registry-write";
import { claimsMode, createClaim, isWalletAddress, newClaimId } from "@/lib/listing-claims";
import {
  enforcePrepareRateLimit,
  type RateLimitVerdict,
} from "@/lib/prepare-rate-limit";

export const dynamic = "force-dynamic";

// The URI is permanent and must resolve with no credentials, so a configured public origin wins.
function publicApiUrl(req: NextRequest): string {
  return (
    process.env.PUBLIC_API_URL ??
    process.env.BASE_URL ??
    req.nextUrl.origin
  )
}

// POST /api/agents/register/prepare: validate, then mint the claim to register against
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  // the wizard posts the draft at top level and the api nests it under "draft", so read both
  const source = (
    body.draft && typeof body.draft === "object" ? body.draft : body
  ) as Partial<RegistrationDraft>;

  const draft: RegistrationDraft = {
    name: typeof source.name === "string" ? source.name : "",
    description: typeof source.description === "string" ? source.description : "",
    category: source.category as RegistrationDraft["category"],
    ...(typeof source.endpoint === "string" ? { endpoint: source.endpoint } : {}),
    ...(typeof source.endpointKind === "string" ? { endpointKind: source.endpointKind } : {}),
    ...(typeof source.image === "string" ? { image: source.image } : {}),
    ...(typeof source.x402Support === "boolean" ? { x402Support: source.x402Support } : {}),
  };

  const validation = validateDraft(draft);
  if (!validation.ok) {
    return NextResponse.json(
      {
        success: false,
        error: validation.errors[0] ?? "That listing is not ready to register.",
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  if (owner && !isWalletAddress(owner)) {
    return NextResponse.json(
      { success: false, error: "Owner must be a wallet address." },
      { status: 400 },
    );
  }

  // cap the write before the row is created; an unreachable store is a refusal, not a fallthrough
  let rate: RateLimitVerdict;
  try {
    rate = await enforcePrepareRateLimit({
      owner,
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Registration is temporarily unavailable, please try again shortly.",
      },
      { status: 503 },
    );
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many listings prepared from this address. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const chainId = targetChainId();
  let registry: Address;
  try {
    registry = registryAddress(chainId);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  const claimId = newClaimId();
  const claim = await createClaim({
    claimId,
    chainId,
    owner,
    agentUri: registrationUrl(publicApiUrl(req), claimId),
    draft,
  });

  return NextResponse.json({
    success: true,
    claimId: claim.claimId,
    agentUri: claim.agentUri,
    chainId,
    registryAddress: registry,
    registerCalldata: encodeRegister(chainId, claim.agentUri),
    persistence: claimsMode(),
  });
}
