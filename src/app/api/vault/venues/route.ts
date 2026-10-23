import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";
import { venueAddresses, venuesFor } from "@/lib/venue-registry";

export const dynamic = "force-dynamic";

// GET /api/vault/venues?chain=56
// the venues a hire can name, with the adapter address it records, so the hire
// view can resolve a venue without carrying its own copy of the registry
export async function GET(req: NextRequest): Promise<NextResponse> {
  const asked = Number(req.nextUrl.searchParams.get("chain"));
  const chainId = Number.isFinite(asked) && asked > 0 ? asked : targetChainId();

  return NextResponse.json(
    {
      success: true,
      chainId,
      venues: venuesFor(chainId).map((v) => ({
        id: v.id,
        name: v.name,
        protocol: v.protocol,
        kind: v.kind,
        status: v.status,
        rateBps: v.rateBps,
        rateAsOf: v.rateAsOf,
        note: v.note,
        addresses: venueAddresses(v),
      })),
    },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
