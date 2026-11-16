import { NextResponse } from "next/server";
import { FLUX_POOLS_URL, summarizeFluxPools } from "@/lib/flux-summary";

export const dynamic = "force-dynamic";

// GET /api/flux/summary
// Flux LP's headline figures for the homepage. The pools endpoint does not
// allow cross-origin reads, so the site reads it through here.
export async function GET() {
  try {
    const res = await fetch(FLUX_POOLS_URL, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return unavailable(`flux pools answered ${res.status}`);
    const summary = summarizeFluxPools(await res.json());
    if (!summary) return unavailable("flux pools returned no pools");
    return NextResponse.json(
      { success: true, ...summary },
      { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } },
    );
  } catch (e) {
    return unavailable((e as Error).message.slice(0, 120));
  }
}

function unavailable(error: string) {
  return NextResponse.json({ success: false, error }, { status: 502, headers: { "cache-control": "no-store" } });
}
