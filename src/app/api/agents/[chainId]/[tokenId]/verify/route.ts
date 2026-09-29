import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { baseUrl, fetchJson, verifyAndRecord } from "@/lib/verify-candidate";
import { isAgentOwner, verifyBoostOwnership } from "@/lib/boost-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// One paid probe for a single listing, so a fresh registration gets its badge
// from the wizard instead of waiting for a scheduled pass. Bounded by design:
// admitted tokens only, and never twice within twenty hours, so neither a
// lister nor a stranger can spend the relay dry through this route.
const REPROBE_MS = 20 * 60 * 60 * 1000;

// The registered owner may force a fresh probe, so a lister can re-check on
// demand; anyone else keeps the twenty hour cap.
function recheckMessage(chainId: number, tokenId: string, owner: string): string {
  return [
    "Agent Souk re-check",
    `chainId: ${chainId}`,
    `tokenId: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
  ].join("\n");
}

async function ownerMayForce(
  chainId: number,
  tokenId: string,
  detail: { owner_address?: string | null; agent_wallet?: string | null },
  body: { force?: unknown; owner?: unknown; signature?: unknown },
): Promise<boolean> {
  if (body?.force !== true) return false;
  const owner = typeof body.owner === "string" ? body.owner : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!owner || !signature) return false;
  if (!isAgentOwner(owner, detail)) return false;
  const verdict = await verifyBoostOwnership({
    message: recheckMessage(chainId, tokenId, owner),
    signature,
    expectedOwner: owner,
  });
  return verdict.ok;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "unsupported chain" }, { status: 400 });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    force?: unknown;
    owner?: unknown;
    signature?: unknown;
  };

  const detailRes = await fetchJson(`${baseUrl()}/api/agents/${chainId}/${tokenId}`, {}, 45000);
  const detail = detailRes.body?.data;
  if (detailRes.status !== 200 || !detail) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }
  if (detail.category === "general" || (!detail.a2a_endpoint && !detail.mcp_server)) {
    return NextResponse.json(
      { success: false, error: "not admitted: no category or callable endpoint, so a probe would spend a hire to learn nothing" },
      { status: 409 },
    );
  }

  const forced = await ownerMayForce(chainId, tokenId, detail, body);

  const seen = (await loadVerifications().catch(() => new Map())).get(tokenId);
  if (!forced && seen?.checkedAt && Date.now() - Date.parse(seen.checkedAt) < REPROBE_MS) {
    return NextResponse.json({ success: true, skipped: true, verification: seen });
  }

  const verdict = await verifyAndRecord({
    chainId,
    tokenId,
    name: detail.name ?? `agent ${tokenId}`,
    category: detail.category ?? "general",
  });
  return NextResponse.json({ success: true, skipped: false, forced, verification: verdict });
}
