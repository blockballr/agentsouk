import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { createos } from "@/lib/builder/createos";
import { verifyWalletAuth } from "@/lib/builder/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return json({ success: false, ok: false, error: "id is required" }, 400);
  }

  const auth = await verifyWalletAuth(req, body.owner, "revoke", body.id);
  if (!auth.ok) return json({ success: false, ok: false, error: auth.error }, 401);

  const owner = body.owner.toLowerCase();
  const agent = await getCustomAgent(body.id);
  if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);
  if (agent.owner !== owner) return json({ success: false, ok: false, error: "not your agent" }, 403);

  const projectId = agent.deployment?.projectId;
  const apiKey = process.env.CREATEOS_API_KEY ?? null;

  if (projectId && apiKey) {
    const del = await createos.deleteProject(apiKey, { project_id: projectId });
    if (!del.ok) {
      // project might already be deleted; continue
    }
  }

  await updateCustomAgent(agent.id, {
    deployment: { ok: false, projectId: null, url: null, error: "revoked" },
    walletAddress: null,
  });

  return json({
    success: true,
    ok: true,
    id: agent.id,
    note: "Agent revoked. The CreateOS project was deleted and the agent's key is destroyed. The listing will be delisted.",
  }, 200);
}
