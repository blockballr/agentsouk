import { NextRequest } from "next/server";
import { requireMember, stationJson, stationRoute } from "@/lib/station-auth";
import { refreshIndexFromLive } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/station/sweep - trigger a shelf refresh (re-classify + capture skills).
// Visible to everyone as a button, but only operators and owners may run it.
export const POST = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "operator");
  if (refusal) return refusal;
  const report = await refreshIndexFromLive();
  return stationJson({ success: true, report });
});

export const GET = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "operator");
  if (refusal) return refusal;
  const report = await refreshIndexFromLive();
  return stationJson({ success: true, report });
});
