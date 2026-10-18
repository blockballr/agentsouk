import { NextRequest } from "next/server";
import { requireMember, stationJson, stationRoute } from "@/lib/station-auth";
import { runLiveness } from "@/app/api/cron/liveness/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/station/probe - manually run the liveness probe (the same sweep the
// cron runs), so an operator can re-check a listing without waiting for the
// scheduled pass. Operator and owner only.
export const POST = stationRoute(async (req: NextRequest) => {
  const { refusal } = await requireMember(req, "operator");
  if (refusal) return refusal;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return stationJson({ success: false, error: "liveness sweep is not configured" }, 503);
  }

  const limit = req.nextUrl.searchParams.get("limit") ?? "25";
  const all = req.nextUrl.searchParams.get("all") === "1";
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const probeReq = new NextRequest(
    `http://localhost/api/cron/liveness?limit=${encodeURIComponent(limit)}${all ? "&all=1" : ""}${dry ? "&dry=1" : ""}`,
    { headers: { authorization: `Bearer ${cronSecret}` } },
  );
  const res = await runLiveness(probeReq);
  const body = await res.json().catch(() => null);
  return stationJson(body ?? { success: res.ok });
});

export const GET = POST;