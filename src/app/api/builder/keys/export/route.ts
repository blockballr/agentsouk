import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { nonceIsFresh } from "@/lib/builder/auth";
import { requestExport, completeExport } from "@/lib/builder/keys";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

function exportMessage(agentId: string, owner: string, nonce: string): string {
  return `Agent Souk key export\nagent: ${agentId}\nby: ${owner.toLowerCase()}\nnonce: ${nonce}`;
}

// POST /api/builder/keys/export  { owner, agentId, signature, nonce }
// verifies the signature and returns the raw key immediately (tap-to-reveal).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown; agentId?: unknown; signature?: unknown; nonce?: unknown;
  } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body?.agentId !== "string" || !/^[0-9a-f]{16}$/.test(body.agentId)) {
    return json({ success: false, error: "agentId must be a built agent id" }, 400);
  }
  if (typeof body?.signature !== "string" || typeof body?.nonce !== "string") {
    return json({ success: false, error: "signature and nonce are required" }, 400);
  }
  if (!nonceIsFresh(body.nonce)) return json({ success: false, error: "signature expired, reload the page and try again" }, 403);
  const owner = body.owner;
  const agentId = body.agentId;
  const message = exportMessage(agentId, owner, body.nonce);
  const ok = await verifyMessage({ address: owner as `0x${string}`, message, signature: body.signature as `0x${string}` }).catch(() => false);
  if (!ok) return json({ success: false, error: "signature did not match the owner" }, 403);

  const result = await requestExport(owner, agentId);
  if (!result.ok) return json({ success: false, error: result.reason }, 400);
  const completed = await completeExport(owner, agentId);
  if (!completed.ok) return json({ success: false, error: completed.reason }, 400);
  return json({ success: true, key: completed.key });
}
