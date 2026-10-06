import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun, latestCronRuns } from "@/lib/history-store";
import { targetChainId } from "@/lib/types";
import {
  ROUTE_BUDGETS,
  stalenessBreaches,
  alertLine,
  shouldEmail,
  markAlerted,
  type StaleRoute,
} from "@/lib/cron-staleness";
import { notifyTeamAlert } from "@/lib/notify";

export const dynamic = "force-dynamic";

// GET /api/cron/staleness - the alert half of the scheduled jobs: reads the
// durable run log, names every route past its allowed silence, emails the team
// at most once per half budget per route, and answers with the full reading
// either way. Fails closed like the other cron routes: no secret, no service.

export function GET(req: NextRequest) {
  return loggedCronRun("staleness", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "staleness check is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const runs = await latestCronRuns();
  const stale = stalenessBreaches(runs, now);

  const emailed: string[] = [];
  const held: string[] = [];
  for (const route of stale) {
    const budget = ROUTE_BUDGETS.find((b) => b.name === route.name)!;
    // mail at most once per half budget, so a runner nobody fixes stays a slow
    // nag rather than a storm
    if (await shouldEmail(route.name, budget.allowedGapMs / 2)) {
      const sent = await notifyTeamAlert(
        `[agentsouk] ${route.label} has gone quiet`,
        [
          `The scheduled job is overdue on the deployed API.`,
          `Target chain: ${targetChainId()}`,
          `Checked at: ${new Date(now).toISOString()}`,
          ``,
          alertLine(route),
        ].join("\n"),
      );
      if (sent.provider === "resend" && sent.ok) {
        emailed.push(route.name);
        await markAlerted(route.name);
      } else {
        // logged only (or the send failed): the next run can try again
        held.push(route.name);
      }
    } else {
      held.push(route.name);
    }
  }

  const routes = stale.map((s: StaleRoute) => ({
    ...s,
    ageHours: s.age !== null ? Math.round((s.age / 3_600_000) * 10) / 10 : null,
  }));

  return NextResponse.json({
    success: true,
    checkedAt: new Date(now).toISOString(),
    stale: emailed.length + held.length > 0,
    routes,
    emailed,
    held,
    budgetCounts: ROUTE_BUDGETS.length,
  });
}
