import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { enqueueSweep } from "@/lib/verifications-store";
import { emitNotification } from "@/lib/notifications";
import { verifyWalletAuth } from "@/lib/builder/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/confirm  { owner, id, txHash, tokenId? }
// Called after the user sends the registration transaction. Records the on-chain
// token ID and enqueues the agent for verification.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown; txHash?: unknown; tokenId?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return json({ success: false, ok: false, error: "id is required" }, 400);
  }
  const confAuth = await verifyWalletAuth(req, body.owner, "confirm", body.id);
  if (!confAuth.ok) return json({ success: false, ok: false, error: confAuth.error }, 401);
  if (typeof body.txHash !== "string" || !body.txHash.trim()) {
    return json({ success: false, ok: false, error: "txHash is required" }, 400);
  }

  const owner = body.owner.toLowerCase();
  const agent = await getCustomAgent(body.id);
  if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);
  if (agent.owner !== owner) return json({ success: false, ok: false, error: "not your agent" }, 403);

  const tokenId = typeof body.tokenId === "string" ? body.tokenId : null;
  const patch: Record<string, unknown> = {};
  if (tokenId) patch.onChainTokenId = tokenId;
  await updateCustomAgent(body.id, patch as Parameters<typeof updateCustomAgent>[1]);

  // enqueue for verification
  if (tokenId) {
    void enqueueSweep(tokenId, agent.manifest.name, agent.manifest.category ?? "general").catch(() => {});
  }

  // notify
  void emitNotification({
    wallet: owner,
    kind: "custom_registered",
    eventKey: body.id,
    title: "Agent registered",
    body: `${agent.manifest.name} is registered on chain (token ${tokenId ?? "pending"}). The marketplace will verify the endpoint and activity proof before listing.`,
    href: `/agents`,
  }).catch(() => {});

  return json({ success: true, ok: true, id: agent.id, tokenId, txHash: body.txHash }, 200);
}