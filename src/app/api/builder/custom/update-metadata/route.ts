import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/update-metadata  { owner, id, description?, image? }
// Updates the stored agent record. Since the on-chain agentURI points to our
// dynamic metadata endpoint, the change is visible to other marketplaces
// without an on-chain transaction. Also returns a prepared setAgentURI payload
// in case the owner wants to point the on-chain URI elsewhere.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown; description?: unknown; image?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body.id !== "string") {
    return json({ success: false, ok: false, error: "id is required" }, 400);
  }
  const owner = body.owner.toLowerCase();
  const agent = await getCustomAgent(body.id);
  if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);
  if (agent.owner !== owner) return json({ success: false, ok: false, error: "not your agent" }, 403);

  const patch: Record<string, unknown> = {};
  if (typeof body.description === "string" && body.description.trim()) {
    agent.manifest.description = body.description.trim();
    patch.manifest = agent.manifest;
  }
  if (body.image === null || body.image === "") {
    patch.image = null;
  } else if (typeof body.image === "string") {
    patch.image = body.image.trim();
  }

  const updated = await updateCustomAgent(body.id, patch as Parameters<typeof updateCustomAgent>[1]);
  if (!updated) return json({ success: false, ok: false, error: "update failed" }, 503);

  const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  const metadataUrl = `${origin.replace(/\/+$/, "")}/api/builder/custom/agent/${updated.id}/metadata`;

  return json({
    success: true,
    ok: true,
    id: updated.id,
    metadataUrl,
    image: updated.image,
    description: updated.manifest.description,
    // prepared setAgentURI payload for owners who want to push the URI on-chain
    setAgentUri: {
      prepared: true,
      sendsTransaction: false,
      agentId: updated.id,
      newUri: metadataUrl,
      note: "Send setAgentURI(agentId, newUri) from your wallet to update the on-chain record. Other marketplaces will then fetch the latest metadata from metadataUrl.",
    },
  }, 200);
}