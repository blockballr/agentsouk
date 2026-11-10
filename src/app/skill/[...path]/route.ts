import { NextRequest, NextResponse } from "next/server";
import { readSkillDoc } from "@/lib/skill-files";

export const dynamic = "force-dynamic";

// GET /skill/reference/<name>.md serves one routed doc. The map in skill-files
// is the allowlist, so a traversal or an unknown name is a plain 404.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const parts = (await ctx.params).path ?? [];
  const text = await readSkillDoc(parts.join("/"));
  if (text === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(text, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
