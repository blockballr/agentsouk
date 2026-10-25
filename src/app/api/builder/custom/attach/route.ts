import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, saveCustomAgent, updateCustomAgent, validateCustomManifest } from "@/lib/builder/custom";
import { privateEndpointReason } from "@/lib/endpoint";
import { verifyWalletAuth } from "@/lib/builder/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/attach  { owner, id?, manifest?, endpoint, image? }
// Persists a manually deployed endpoint so the manual lane survives a reload.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    id?: unknown;
    manifest?: unknown;
    endpoint?: unknown;
    image?: unknown;
  } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner;
  const id = typeof body.id === "string" ? body.id : null;
  const auth = await verifyWalletAuth(req, owner, "attach", id ?? "");
  if (!auth.ok) return json({ success: false, ok: false, error: auth.error }, 401);

  if (typeof body.endpoint !== "string" || !body.endpoint.trim()) {
    return json({ success: false, ok: false, error: "endpoint is required" }, 400);
  }
  const endpoint = body.endpoint.trim();
  const reason = privateEndpointReason(endpoint);
  if (reason) return json({ success: false, ok: false, error: reason }, 400);
  try {
    if (new URL(endpoint).protocol !== "https:") {
      return json({ success: false, ok: false, error: "endpoint must be https" }, 400);
    }
  } catch {
    return json({ success: false, ok: false, error: "endpoint is not a valid url" }, 400);
  }

  let agentId = id;
  if (agentId) {
    const existing = await getCustomAgent(agentId);
    if (!existing) return json({ success: false, ok: false, error: "agent not found" }, 404);
    if (existing.owner.toLowerCase() !== owner.toLowerCase()) {
      return json({ success: false, ok: false, error: "owner does not match" }, 403);
    }
    if (body.manifest !== undefined) {
      const check = validateCustomManifest(body.manifest);
      if (!check.ok) return json({ success: false, ok: false, error: check.errors.join("; ") }, 400);
      await updateCustomAgent(agentId, { manifest: check.manifest });
    }
  } else {
    if (body.manifest === undefined) {
      return json({ success: false, ok: false, error: "manifest is required when no id is given" }, 400);
    }
    const check = validateCustomManifest(body.manifest);
    if (!check.ok) return json({ success: false, ok: false, error: check.errors.join("; ") }, 400);
    const agent = await saveCustomAgent(owner, check.manifest, null);
    agentId = agent.id;
  }

  const patch: Record<string, unknown> = {
    deployment: { ok: true, url: endpoint, manual: true, projectId: null, error: null },
  };
  if (typeof body.image === "string" && body.image.trim()) patch.image = body.image.trim();

  const updated = await updateCustomAgent(agentId as string, patch as Parameters<typeof updateCustomAgent>[1]);
  if (!updated) return json({ success: false, ok: false, error: "agent not found" }, 404);

  return json({ success: true, ok: true, id: updated.id, endpoint });
}
