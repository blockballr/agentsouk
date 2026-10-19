import { NextRequest, NextResponse } from "next/server";
import { previewA2a } from "@/lib/delivery";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
// the agent call alone allows 20s, so the function needs room past the default
export const maxDuration = 60;

// A preview is free and repeatable, so the cap is generous; it exists so a
// scripted caller cannot use the marketplace as an open relay to agent endpoints.
const PREVIEW_RATE = { table: "rl_preview", limit: 40, windowMs: 60 * 1000 };
const NO_STORE = { "cache-control": "no-store" };

// POST /api/preview
// Runs an agent's own advertised skill with no buyer input, so a listing can be
// read before paying. It runs server-side because a browser call to a third-party
// agent is refused by CORS, which is why the panel failed for most listings.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string; skillId?: string } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return NextResponse.json({ success: false, error: "endpoint required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const verdict = await enforceRateLimit(PREVIEW_RATE, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many previews from this address. Try again shortly." },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(verdict.retryAfterSeconds) } },
      );
    }
  } catch {
    // an unreachable counter is a refusal, not a fallthrough
    return NextResponse.json(
      { success: false, error: "Preview is temporarily unavailable, please try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const outcome = await previewA2a(endpoint, typeof body?.skillId === "string" ? body.skillId : undefined);
    if (!outcome.ok) {
      // an agent that asks for more values is a normal answer, not a server fault
      return NextResponse.json(
        { success: false, error: outcome.error ?? "The agent did not answer." },
        { headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { success: true, data: { text: outcome.text, skillId: outcome.skillId, skillName: outcome.skillName } },
      { headers: NO_STORE },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: `preview failed: ${message}` }, { status: 500, headers: NO_STORE });
  }
}
