import { NextRequest, NextResponse } from "next/server";
import { readListingRequests } from "@/lib/listing-request-store";

export const dynamic = "force-dynamic";

// The team's read of the listing review queue, so "a human reads every request"
// is something we can show rather than assert. Same secret as the index builder,
// and it fails closed: with no secret configured the route refuses instead of
// opening.
export async function GET(req: NextRequest) {
  const configured = process.env.INDEX_SECRET;
  if (!configured) {
    return NextResponse.json(
      { success: false, error: "index secret is not configured" },
      { status: 503 },
    );
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  const secret = bearer || req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== configured) {
    return NextResponse.json({ success: false, error: "bad secret" }, { status: 401 });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50;
  const requests = await readListingRequests(limit);
  return NextResponse.json({ success: true, count: requests.length, requests });
}
