import { NextRequest, NextResponse } from "next/server";
import { queryAgents } from "@/lib/scanner";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") ?? "all";
  const q = sp.get("q") ?? "";
  const sort = (sp.get("sort") as "score" | "newest" | "feedback" | "health") ?? "score";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const limit = Math.min(60, Math.max(1, Number(sp.get("limit") ?? 24) || 24));
  const warm = sp.get("warm") === "1";
  const maxWarmPages = Math.min(12, Math.max(1, Number(sp.get("warmPages") ?? 6) || 6));

  const result = await queryAgents({
    category,
    q,
    sort,
    page,
    limit,
    ensureWarm: warm,
    maxWarmPages,
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
}