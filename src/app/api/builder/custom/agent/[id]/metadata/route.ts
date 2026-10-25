import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent } from "@/lib/builder/custom";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

// GET /api/builder/custom/agent/:id/metadata
// Serves the agent's current metadata JSON. This URL is what goes on-chain as
// the agentURI, so updating our stored record automatically updates what other
// marketplaces see when they fetch the URI, so no on-chain transaction needed
// for metadata changes.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const agent = await getCustomAgent(id);
    if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const endpoint = `${origin.replace(/\/+$/, "")}/api/built/${agent.id}/a2a`;
    const storedImage = (agent as { image?: string | null }).image ?? null;
    const image = storedImage ?? `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(`${agent.id}`)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&backgroundType=gradientLinear`;
    const metadata = {
      name: agent.manifest.name,
      description: agent.manifest.description,
      image,
      endpoint,
      wallet: agent.manifest.wallet,
      category: agent.manifest.category,
      actions: agent.manifest.actions,
      updatedAt: agent.updatedAt,
    };

    return NextResponse.json(metadata, {
      headers: { "cache-control": "no-store", "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 503 });
  }
}