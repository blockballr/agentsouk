import { NextRequest, NextResponse } from "next/server";
import { loadStaleTokens } from "@/lib/verifications-store";
import { setDelisted } from "@/lib/delist-store";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// Maintenance pass: a listing the verifier has read as not-delivered
// continuously for seven days leaves the market. One good probe clears the
// clock, so this never fires on a single bad sweep. It writes the same durable
// delisted row the manual route writes, so the owner relists with a signature
// and lifts it.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: "no maintenance secret configured" },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const stale = await loadStaleTokens(STALE_MS);
  const delisted: string[] = [];
  for (const token of stale) {
    const persisted = await setDelisted(token.tokenId, true, "auto-stale");
    if (persisted) delisted.push(token.tokenId);
  }

  return NextResponse.json({
    success: true,
    chainId: targetChainId(),
    windowMs: STALE_MS,
    considered: stale.length,
    delisted,
    stale: stale.map((t) => ({
      tokenId: t.tokenId,
      name: t.name,
      status: t.status,
      failingSince: t.failingSince,
    })),
  });
}

// The pass changes state, so a GET is refused rather than run by accident.
export function GET(): NextResponse {
  return NextResponse.json(
    { success: false, error: "maintenance is POST with the cron secret" },
    { status: 405, headers: { allow: "POST" } },
  );
}
