import { NextRequest, NextResponse } from "next/server";
import { customCardMetadata, getCustomAgent } from "@/lib/builder/custom";
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
    const storedImage = (agent as { image?: string | null }).image ?? null;
    const metadata = customCardMetadata(agent, { origin, image: storedImage });

    return NextResponse.json(metadata, {
      headers: { "cache-control": "no-store", "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 503 });
  }
}