// The standing health watch. Every run walks the operator's active mandates,
// repays the worst position when the buyer's trigger is crossed, and draws the
// daily fee the buyer's subscription earned. A funded job only settles it.
import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { loggedCronRun } from "@/lib/history-store";
import { watchMandates } from "@/lib/health-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.VAULT_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (secrets.length === 0) return false;
  const header = req.headers.get("authorization") ?? "";
  return secrets.includes(header.replace(/^Bearer\s+/i, ""));
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  const operator = process.env.HEALTH_OPERATOR_ADDRESS as Address | undefined;
  const agentKey = process.env.AGENT_EXECUTOR_KEY;
  if (!operator || !agentKey) {
    return json({ error: "the health watch is not configured" }, 503);
  }
  const subscription = process.env.HEALTH_SUBSCRIPTION_ADDRESS as Address | undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 25;
  const result = await watchMandates({ operator, subscription, agentKey: agentKey as `0x${string}`, limit });
  // a buyer skipped because of a fault is a failed run, not a healthy one that
  // happened to do nothing; the status endpoint counts these in a row
  const ok = result.errors === 0;
  return json({ success: ok, ...result }, ok ? 200 : 500);
}

export function GET(req: NextRequest) {
  return loggedCronRun("health-watch", () => run(req));
}

export function POST(req: NextRequest) {
  return loggedCronRun("health-watch", () => run(req));
}
