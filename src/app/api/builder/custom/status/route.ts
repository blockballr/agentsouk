import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, listCustomByOwner } from "@/lib/builder/custom";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/custom/status?owner=0x... | ?id=<agent id>
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? req.nextUrl.searchParams.get("agentId") ?? req.nextUrl.searchParams.get("buildId") ?? "";
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  try {
    if (id) {
      const agent = await getCustomAgent(id);
      if (!agent) return json({ success: false, ok: false, error: "not found" }, 404);
      return json({ success: true, ok: true, status: "deployed", agent, id: agent.id, endpoint: agent.deployment?.url ?? null });
    }
    if (owner) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
      const items = await listCustomByOwner(owner);
      return json({ success: true, ok: true, status: items.length ? "deployed" : "none", items });
    }
    return json({ success: false, ok: false, error: "id or owner is required" }, 400);
  } catch (e) {
    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "status failed" }, 503);
  }
}