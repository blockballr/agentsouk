import { NextRequest, NextResponse } from "next/server";
import { validateCustomManifest, buildId } from "@/lib/builder/custom";
import { verifyWalletAuth } from "@/lib/builder/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/build  { owner?, manifest }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; manifest?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (body.owner !== undefined && body.owner !== null && (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner))) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body.owner === "string") {
    const auth = await verifyWalletAuth(req, body.owner, "build", "");
    if (!auth.ok) return json({ success: false, ok: false, error: auth.error }, 401);
  }
  const manifestInput = body.manifest !== undefined ? body.manifest : body;
  // if manifest missing and body has owner, still require manifest
  const check = validateCustomManifest(manifestInput);
  if (!check.ok) {
    return json({ success: false, ok: false, valid: false, errors: check.errors, error: check.errors[0] }, 422);
  }
  const id = buildId();
  return json({ success: true, ok: true, buildId: id, id, status: "built", manifest: check.manifest }, 200);
}