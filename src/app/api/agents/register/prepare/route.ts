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
import { readSelfHostedDocument, readSelfHostedFileAgainst } from "@/lib/self-hosted-doc";
import { claimsMode, createClaim, isWalletAddress, newClaimId } from "@/lib/listing-claims";
import { normaliseDeclaration } from "@/lib/authority-declaration";
import { claimKey, saveDeclaration } from "@/lib/authority-store";
import { jobCardCheck, type JobCardCheck } from "@/lib/job-card-check";
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
    ...(Array.isArray(source.endpointKinds)
      ? { endpointKinds: source.endpointKinds.filter((k): k is RegistrationDraft["endpointKind"] & string => typeof k === "string") }
      : {}),
    ...(typeof source.endpointKind === "string" ? { endpointKind: source.endpointKind } : {}),
    ...(typeof source.image === "string" ? { image: source.image } : {}),
    ...(typeof source.agentWallet === "string" ? { agentWallet: source.agentWallet } : {}),
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

  // the job branch's authority is the card, fetched once here and bounded; a card that does not
  // declare the protocol refuses the branch before any claim exists, and the claim this mints
  // carries no x402 support, because a job seller refuses a direct paid task by construction
  const chainId = targetChainId();
  const mode = body.mode === "job" ? "job" : body.mode === "both" ? "both" : "call";
  let cardCheck: JobCardCheck | undefined;
  if (mode !== "call") {
    if (!(draft.agentWallet ?? "").trim()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A job seller is paid from an agent wallet when a job releases, so this listing needs one before it can register.",
        },
        { status: 400 },
      );
    }
    cardCheck = await jobCardCheck({
      endpoint: (draft.endpoint ?? "").trim(),
      chainId,
      expectedProvider: draft.agentWallet ?? null,
    });
    if (cardCheck.state !== "verified") {
      return NextResponse.json(
        { success: false, error: cardCheck.detail, cardCheck },
        { status: 400 },
      );
    }
    // job-only turns the direct rail off; both keeps it on and still takes escrow work
    draft.x402Support = mode === "both";
  }

  // a lister serving the document at their own domain registers that link:
  // the doc is read once here, shape-checked, and confirm verifies that exact uri
  const selfHosted = draft.selfHosted === true;
  let agentUri = "";
  if (selfHosted) {
    const ownUri = (draft.ownUri ?? "").trim();
    if (!/^https:\/\//i.test(ownUri)) {
      return NextResponse.json(
        { success: false, error: "Hosting your own document needs its https link." },
        { status: 400 },
      );
    }
    const read = await readSelfHostedDocument(ownUri);
    if (!read.ok) {
      return NextResponse.json({ success: false, error: read.error }, { status: 400 });
    }
    const checked = readSelfHostedFileAgainst(read.file, draft);
    if (!checked.ok) {
      return NextResponse.json({ success: false, error: checked.error }, { status: 400 });
    }
  }

  let registry: Address;
  try {
    registry = registryAddress(chainId);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  // an owner may declare how their agent may act at the moment they register,
  // so the ceiling travels with the claim and lands on the token at confirm
  let declared: ReturnType<typeof normaliseDeclaration> | null = null;
  if (body.authority !== undefined && body.authority !== null) {
    declared = normaliseDeclaration(body.authority);
    if (!declared.ok) {
      return NextResponse.json(
        { success: false, error: declared.errors.join("; ") },
        { status: 400 },
      );
    }
  }

  const claimId = newClaimId();
  agentUri = selfHosted ? (draft.ownUri ?? "").trim() : registrationUrl(publicApiUrl(req), claimId);
  const claim = await createClaim({
    claimId,
    chainId,
    owner,
    agentUri,
    draft,
    selfHosted,
  });

  if (declared?.ok) {
    await saveDeclaration(claimKey(claim.claimId), declared.value, owner || "unknown").catch(() => false);
  }

  return NextResponse.json({
    success: true,
    claimId: claim.claimId,
    agentUri: claim.agentUri,
    chainId,
    registryAddress: registry,
    registerCalldata: encodeRegister(chainId, claim.agentUri),
    persistence: claimsMode(),
    ...(declared?.ok ? { authority: declared.value } : {}),
    ...(cardCheck ? { cardCheck } : {}),
  });
}
