import { NextRequest, NextResponse } from "next/server";
import { recordListingView, readListingViews, visitorKey } from "@/lib/listing-views";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
// an automated reader is not an impression: discovery crawlers open every list
// page they can find, and counting them would make the number meaningless
const BOT = /bot|crawl|spider|slurp|headless|preview|monitor/i;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

// One page open is one impression, deduped server-side to one an hour per
// reader. The body names the listing the page is actually showing, so a view is
// never attributed to whatever token the request happened to carry.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: unknown;
    tokenId?: unknown;
  } | null;
  const chainId = Number(body?.chainId);
  const tokenId = String(body?.tokenId ?? "");
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "bad chain id" }, { status: 400, headers: NO_STORE });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400, headers: NO_STORE });
  }
  const userAgent = req.headers.get("user-agent") ?? "";
  if (BOT.test(userAgent)) return new NextResponse(null, { status: 204, headers: NO_STORE });
  await recordListingView(chainId, tokenId, visitorKey(clientIp(req), userAgent));
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

// The counts a seller's own board reads. They are not secret: an impression is
// public attention on a public listing.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chainId") ?? targetChainId());
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "bad chain id" }, { status: 400, headers: NO_STORE });
  }
  const tokens = (url.searchParams.get("tokens") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d+$/.test(t))
    .slice(0, 50);
  const asked = Number(url.searchParams.get("days") ?? 14);
  const days = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 90) : 14;
  const counts = await readListingViews(chainId, tokens, days);
  return NextResponse.json(
    { success: true, chainId, days, counts: Object.fromEntries(counts) },
    { headers: NO_STORE },
  );
}
