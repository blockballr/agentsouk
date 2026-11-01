import { NextResponse } from "next/server";
import { readFreshness } from "@/lib/freshness";
import { readNetwork } from "@/lib/network-reading";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const now = Date.now();
  const { reading, cached, cacheMs } = await readNetwork(targetChainId());

  return NextResponse.json(
    {
      data: reading,
      error: reading.price === null && reading.tps === null ? "all sources unavailable" : null,
      meta: { cached, checkedAt: reading.checkedAt, freshness: readFreshness(reading.checkedAt, now), cacheMs },
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
