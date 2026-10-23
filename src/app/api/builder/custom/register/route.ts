import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, validateCustomManifest } from "@/lib/builder/custom";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/register  { owner, id?, agentId?, manifest? }
// Prepares (never sends) an ERC-8004 registration for the builder's wallet.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown; agentId?: unknown; manifest?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner.toLowerCase();
  const id = typeof body.id === "string" ? body.id : (typeof body.agentId === "string" ? body.agentId : null);

  let manifest = null;
  if (id) {
    const agent = await getCustomAgent(id);
    if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);
    manifest = agent.manifest;
  } else if (body.manifest !== undefined) {
    const check = validateCustomManifest(body.manifest);
    if (!check.ok) return json({ success: false, ok: false, valid: false, errors: check.errors, error: check.errors[0] }, 422);
    manifest = check.manifest;
  } else {
    return json({ success: false, ok: false, error: "id or manifest is required" }, 400);
  }

  const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  const registration = {
    owner,
    type: "erc8004",
    prepared: true,
    sendsTransaction: false,
    manifest,
    endpoint: id ? `${origin.replace(/\/+$/, "")}/api/built/${id}/a2a` : null,
  };
  return json({ success: true, ok: true, prepared: true, registration }, 200);
}