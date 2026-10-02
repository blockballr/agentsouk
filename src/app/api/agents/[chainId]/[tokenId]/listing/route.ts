import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { isAgentOwner, verifyBoostOwnership } from "@/lib/boost-auth";
import { privateEndpointReason } from "@/lib/endpoint";
import {
  EDIT_SIGNATURE_WINDOW_MS,
  checkListingEdit,
  editDigest,
  isEmptyEdit,
  listingEditMessage,
  type ListingEdit,
} from "@/lib/listing-edit";
import { loadListingEdit, saveListingEdit } from "@/lib/listing-edit-store";
import { asksForSecrets } from "@/lib/quest-eligibility";
import { clientIpFrom, enforceRateLimit, type RateLimitVerdict } from "@/lib/rate-limit";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// an owner rewrites a listing a handful of times, so this only stops a script
const EDIT_RATE = {
  table: "listing_edit_rate_limits",
  limit: 20,
  windowMs: 60 * 60 * 1000,
};

// a caller who has not proved anything is counted on their own key before any
// lookup, so unauthenticated traffic is bounded without spending the owner's
// budget on a listing the caller does not own
const CALLER_RATE = {
  table: "listing_edit_caller_rate",
  limit: 60,
  windowMs: 60 * 60 * 1000,
};

// the largest edit is a signature, a description and three examples, so this is generous
const MAX_BODY = 20_000;

function refuse(status: number, error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

function hasHiddenCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f)) return true;
    if ((c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}

// what a buyer will read must not ask for a wallet's secret, hide characters, or point an
// image at a private address
function safetyProblems(edit: ListingEdit): string[] {
  const problems: string[] = [];
  const texts: [string, string | null][] = [
    ["description", edit.description],
    ...edit.examples.flatMap((e, i): [string, string | null][] => [
      [`example ${i + 1}`, e.task],
      [`example ${i + 1} values`, e.input],
    ]),
  ];
  for (const [name, text] of texts) {
    if (!text) continue;
    if (hasHiddenCharacter(text)) problems.push(`${name}: must be plain text on one line`);
    if (asksForSecrets(text)) problems.push(`${name}: must not mention private keys, seed phrases or passwords`);
  }
  if (edit.imageUrl && privateEndpointReason(edit.imageUrl)) problems.push("the image must be at a public address");
  return problems;
}

// POST /api/agents/[chainId]/[tokenId]/listing
// the registered owner changes how the listing reads here: description, examples and image.
// The registry record is never touched. An empty edit puts the registry's own text back
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
): Promise<NextResponse> {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) return refuse(400, "bad chain id");
  if (!/^\d+$/.test(tokenId)) return refuse(400, "bad token id");

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return refuse(413, "the request body is too large");
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const body = parsed as {
    owner?: unknown;
    signature?: unknown;
    issuedAt?: unknown;
    edit?: unknown;
  } | null;

  try {
    const caller = await enforceRateLimit(CALLER_RATE, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!caller.allowed) return refuse(429, "Too many edit attempts. Try again later.");
  } catch {
    return refuse(503, "Editing is temporarily unavailable, please try again shortly.");
  }

  const owner = typeof body?.owner === "string" ? body.owner : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const issuedAt = typeof body?.issuedAt === "string" ? body.issuedAt : "";
  if (!owner || !signature || !issuedAt) return refuse(400, "owner, signature and issuedAt required");

  const signedAt = Date.parse(issuedAt);
  if (!Number.isFinite(signedAt) || new Date(signedAt).toISOString() !== issuedAt) {
    return refuse(400, "issuedAt must be an ISO time");
  }
  if (Math.abs(Date.now() - signedAt) > EDIT_SIGNATURE_WINDOW_MS) {
    return refuse(400, "that signature is too old, sign the edit again");
  }

  const checked = checkListingEdit(body?.edit);
  if (!checked.ok) return refuse(400, checked.errors.join("; "));
  const problems = safetyProblems(checked.edit);
  if (problems.length) return refuse(400, problems.join("; "));

  const agent = await getAgentByToken(chainId, tokenId);
  if (!agent) return refuse(404, "agent not found");
  if (!isAgentOwner(owner, agent)) return refuse(403, "only the registered owner may edit this listing");

  const expected = listingEditMessage(chainId, tokenId, owner, await editDigest(checked.edit), issuedAt);
  const verdict = await verifyBoostOwnership({ message: expected, signature, expectedOwner: owner });
  if (!verdict.ok) return refuse(403, verdict.error ?? "signature did not match the owner");

  // charged only now that a signature has proved the caller owns this listing: the
  // owner address is public, so charging earlier would let a stranger spend the
  // budget that is meant to stop the owner scripting edits
  let rate: RateLimitVerdict;
  try {
    rate = await enforceRateLimit(EDIT_RATE, { keys: [`token:${chainId}:${tokenId}`] });
  } catch {
    return refuse(503, "Editing is temporarily unavailable, please try again shortly.");
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Too many edits for this listing. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  // an edit signed before the one already stored is a replay, however fresh its window
  const current = await loadListingEdit(chainId, tokenId);
  if (current && Date.parse(current.updatedAt) >= signedAt) {
    return refuse(409, "a newer edit is already saved, reload and try again");
  }

  // an emptied edit is stored too, so its time still guards against an older one being replayed
  const persisted = await saveListingEdit(chainId, tokenId, checked.edit, owner, issuedAt);
  if (!persisted) return refuse(503, "the edit could not be saved, try again");
  return NextResponse.json({
    success: true,
    tokenId,
    listing: isEmptyEdit(checked.edit) ? null : { ...checked.edit, updatedAt: issuedAt },
  });
}
