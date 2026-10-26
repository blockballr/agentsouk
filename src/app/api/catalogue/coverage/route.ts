import { NextResponse } from "next/server";
import { getCatalogueCoverage } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function GET() {
  const coverage = await getCatalogueCoverage();
  return NextResponse.json(
    { success: true, coverage },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}