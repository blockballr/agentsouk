import { NextRequest, NextResponse } from "next/server";
import { autoCurateScout } from "@/lib/scout-curate";
import { saveScoutJson } from "@/lib/scout-pipeline";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/scout/curate?secret=...
// merge scout-delivered specialists into data/agents.json (marketplace shelf)

export async function POST(req: NextRequest) {
  const configured = process.env.INDEX_SECRET;
  if (!configured) {
    return NextResponse.json(
      { success: false, error: "index secret is not configured" },
      { status: 503 },
    );
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  const secret = bearer || req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== configured) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const chain = Number(req.nextUrl.searchParams.get("chain") ?? targetChainId()) || targetChainId();

  const result = await autoCurateScout(chain);
  await saveScoutJson("log-curate.json", {
    at: new Date().toISOString(),
    added: result.added,
    skipped: result.skipped,
    already: result.already,
    total: result.total,
    names: result.addedAgents.map((a) => a.name),
  }, chain);

  return NextResponse.json({
    success: true,
    added: result.added,
    skipped: result.skipped,
    already: result.already,
    total: result.total,
    counts: result.counts,
    addedAgents: result.addedAgents.map((a) => ({
      token_id: a.token_id,
      name: a.name,
      category: a.category,
      total_score: a.total_score,
    })),
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    hint: "POST with INDEX_SECRET to merge scout-delivered agents into data/agents.json",
  });
}
