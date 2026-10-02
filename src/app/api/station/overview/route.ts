import { NextRequest } from "next/server";
import { requireMember, stationJson, stationRoute } from "@/lib/station-auth";
import { stationOverview } from "@/lib/station-data";

export const dynamic = "force-dynamic";

// GET /api/station/overview, for any member
export const GET = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "viewer");
  if (refusal) return refusal;
  return stationJson({ success: true, overview: await stationOverview() });
});
