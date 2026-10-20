import { NextRequest, NextResponse } from "next/server";
import { builtAgentCard } from "@/lib/builder/a2a";
import { getBuiltAgent } from "@/lib/builder/store";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
};

// GET /api/built/<id>/.well-known/agent-card.json
// the card a built agent's registration points at
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const built = await getBuiltAgent(id);
    if (!built) return NextResponse.json({ error: "No agent is hosted at this address." }, { status: 404, headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    // a blueprint never changes once saved, so its card may be held for a while
    return NextResponse.json(builtAgentCard(built.blueprint, { origin, id }), {
      headers: { ...JSON_HEADERS, "cache-control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "The agent cannot be read just now." }, { status: 503, headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
  }
}
