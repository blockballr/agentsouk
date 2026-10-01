import { NextRequest, NextResponse } from "next/server";
import { getAgentByToken } from "@/lib/scanner";
import { isAgentOwner, verifyBoostOwnership } from "@/lib/boost-auth";
import { setDelisted } from "@/lib/delist-store";
import { listingControlMessage, type ListingAction } from "@/lib/listing-control";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// Only the registry owner (or agent wallet) may take a listing off the market,
// proven by a signature over a message bound to the token and the action, so a
// captured signature cannot relist or delist a different token. Delisting never
// touches the on-chain registration, which is a chain fact we do not control.

async function handle(
  req: NextRequest,
  chainRaw: string,
  tokenId: string,
  action: ListingAction,
): Promise<NextResponse> {
  const chainId = Number(chainRaw);
  // the delist store is keyed by token id alone, so only this deployment's chain may be
  // controlled here; the owner of the same token number on another chain must not reach it
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "bad chain id" }, { status: 400 });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    signature?: unknown;
  } | null;
  const owner = typeof body?.owner === "string" ? body.owner : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!owner || !signature) {
    return NextResponse.json(
      { success: false, error: "owner and signature required" },
      { status: 400 },
    );
  }

  const agent = await getAgentByToken(chainId, tokenId);
  if (!agent) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }
  if (!isAgentOwner(owner, agent)) {
    return NextResponse.json(
      { success: false, error: "only the registered owner may control this listing" },
      { status: 403 },
    );
  }

  const expected = listingControlMessage(chainId, tokenId, owner, action);
  const verdict = await verifyBoostOwnership({
    message: expected,
    signature,
    expectedOwner: owner,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { success: false, error: verdict.error ?? "signature did not match the owner" },
      { status: 403 },
    );
  }

  const persisted = await setDelisted(
    tokenId,
    action === "delist",
    action === "delist" ? "owner delist" : undefined,
  );
  if (!persisted) {
    return NextResponse.json(
      { success: false, error: "the delist could not be persisted, try again" },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true, tokenId, delisted: action === "delist" });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
): Promise<NextResponse> {
  const { chainId, tokenId } = await params;
  return handle(req, chainId, tokenId, "delist");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
): Promise<NextResponse> {
  const { chainId, tokenId } = await params;
  return handle(req, chainId, tokenId, "relist");
}
