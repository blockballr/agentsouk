import { NextRequest, NextResponse } from "next/server";
import { exportBuiltAgent } from "@/lib/builder/export";
import { getBuiltAgent } from "@/lib/builder/store";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/export?id=<built id>
// returns the files of a standalone repo for the built agent, so it can be
// pushed to GitHub and imported by CreateOS. The GitHub push itself is the next
// step; today the files come back as JSON.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return json({ success: false, error: "id is required" }, 400);
  try {
    const built = await getBuiltAgent(id);
    if (!built) return json({ success: false, error: "No agent is hosted at this address." }, 404);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const result = exportBuiltAgent(built, origin);
    return json({ success: true, id: built.id, name: built.blueprint.name, ...result });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "export failed" }, 503);
  }
}
