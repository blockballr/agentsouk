import { NextRequest, NextResponse } from "next/server";
import { loadQuestShelf } from "@/lib/quest-picks";

export const dynamic = "force-dynamic";

// GET /api/quest/picks - the agents a quest step may offer in each category, in the order the
// shelf rotated them for this visit. An agent is confirmed once a job has completed on it, so
// new listings are offered without anyone naming them
export async function GET(req: NextRequest) {
  const seed = req.nextUrl.searchParams.get("seed");
  const shelf = await loadQuestShelf(seed && seed.length <= 64 ? seed : null);
  return NextResponse.json({ success: true, ...shelf });
}
