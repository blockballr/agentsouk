import { NextResponse } from "next/server";
import { readSkillDoc } from "@/lib/skill-files";

export const dynamic = "force-dynamic";

// GET /skill serves the router. An agent can be pointed at this URL directly.
export async function GET(): Promise<Response> {
  const text = await readSkillDoc("SKILL.md");
  if (text === null) return NextResponse.json({ error: "the skill is unavailable" }, { status: 503 });
  return new Response(text, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
