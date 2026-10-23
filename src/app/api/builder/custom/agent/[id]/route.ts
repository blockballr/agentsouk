import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent } from "@/lib/builder/custom";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/custom/agent/:id
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const agent = await getCustomAgent(id);
    if (!agent) return json({ success: false, ok: false, error: "not found" }, 404);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const endpoint = `${origin.replace(/\/+$/, "")}/api/built/${agent.id}/a2a`;
    return json({
      success: true,
      ok: true,
      id: agent.id,
      owner: agent.owner,
      manifest: agent.manifest,
      endpoint,
      deployment: agent.deployment,
      listingState: agent.deployment?.ok ? "listed-pending-proof" : "unlisted",
    }, 200);
  } catch (e) {
    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "lookup failed" }, 503);
  }
}