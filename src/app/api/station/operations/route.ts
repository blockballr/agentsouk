import { NextRequest } from "next/server";
import { requireMember, stationJson, stationRoute } from "@/lib/station-auth";
import { stationOperations } from "@/lib/station-data";

export const dynamic = "force-dynamic";

// GET /api/station/operations, for any member
export const GET = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "viewer");
  if (refusal) return refusal;
  return stationJson({ success: true, operations: await stationOperations() });
});
