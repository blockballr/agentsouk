import { NextRequest, NextResponse } from "next/server";
import { buildRegistrationFile } from "@/lib/registry-write";
import { getClaim, isClaimExpired } from "@/lib/listing-claims";
import { firstPartyClaimCategory, firstPartyClaimDescription, firstPartyClaimVaultOnly, firstPartyClaimWallet } from "@/lib/first-party-copy";

export const dynamic = "force-dynamic";

// GET /api/agents/register/[claimId]: the registration-v1 document agentURI
// resolves to, served anonymously because third parties fetch it.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const { claimId } = await params;
  const claim = await getClaim(claimId);
  if (!claim) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }
  // 410, not 404: the url was published as a permanent agentURI, so the document is retired, not guessed
  if (isClaimExpired(claim)) {
    return NextResponse.json(
      { error: "this claim expired before it was confirmed" },
      { status: 410 },
    );
  }
  const file = buildRegistrationFile({
    agentId: claim.agentId ?? undefined,
    chainId: claim.chainId,
    draft: claim.draft,
  });
  const canonical = firstPartyClaimDescription(claimId);
  if (canonical) file.description = canonical;
  const canonicalWallet = firstPartyClaimWallet(claimId);
  if (canonicalWallet) file.agentWallet = canonicalWallet;
  if (firstPartyClaimVaultOnly(claimId)) file.x402Support = false;
  const canonicalCategory = firstPartyClaimCategory(claimId);
  if (canonicalCategory) file.category = canonicalCategory;
  return NextResponse.json(file);
}
