import { NextRequest, NextResponse } from "next/server";

// TEMP DEBUG: log a client-side failed signature so we can dissect recovery.
// Remove after the signing investigation. Accepts { signature, message, recovered, expected }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  console.error("[sig-debug]", JSON.stringify(body ?? {}));
  return NextResponse.json({ ok: true });
}
