import { NextRequest, NextResponse } from "next/server";
import { validateCustomManifest } from "@/lib/builder/custom";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/validate  { manifest } or a bare manifest object
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, valid: false, error: "request body must be a JSON object" }, 400);
  }
  const manifestInput = body.manifest !== undefined ? body.manifest : body;
  const check = validateCustomManifest(manifestInput);
  if (!check.ok) {
    return json({ success: false, ok: false, valid: false, errors: check.errors, error: check.errors[0] }, 422);
  }
  return json({ success: true, ok: true, valid: true, manifest: check.manifest }, 200);
}