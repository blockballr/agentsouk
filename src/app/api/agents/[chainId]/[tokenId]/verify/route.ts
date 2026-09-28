import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";
import { baseUrl, fetchJson, verifyAndRecord } from "@/lib/verify-candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// One paid probe for a single listing, so a fresh registration gets its badge
// from the wizard instead of waiting for a scheduled pass. Bounded by design:
// admitted tokens only, and never twice within twenty hours, so neither a
// lister nor a stranger can spend the relay dry through this route.
const REPROBE_MS = 20 * 60 * 60 * 1000;

export async function POST(
  _req: NextRequest,
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

  const seen = (await loadVerifications().catch(() => new Map())).get(tokenId);
  if (seen?.checkedAt && Date.now() - Date.parse(seen.checkedAt) < REPROBE_MS) {
    return NextResponse.json({ success: true, skipped: true, verification: seen });
  }

  const verdict = await verifyAndRecord({
    chainId,
    tokenId,
    name: detail.name ?? `agent ${tokenId}`,
    category: detail.category ?? "general",
  });
  return NextResponse.json({ success: true, skipped: false, verification: verdict });
}
