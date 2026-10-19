import { NextRequest, NextResponse } from "next/server";

// gates a legacy endpoint behind a shared secret so external indexers see it
// as gone (410) while the owner can still reach it with the key
export function legacyGate(req: NextRequest): NextResponse | null {
  const expected = process.env.TAJIR_LEGACY_KEY ?? "";
  if (!expected) return NextResponse.json({ error: "gone" }, { status: 410, headers: { "cache-control": "no-store" } });
  const fromQuery = req.nextUrl.searchParams.get("key") ?? "";
  const fromHeader = req.headers.get("x-gate-key") ?? "";
  if (fromQuery === expected || fromHeader === expected) return null;
  return NextResponse.json({ error: "gone" }, { status: 410, headers: { "cache-control": "no-store" } });
}
