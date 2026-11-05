// The daily session check. A grant lapses on its expiry and breaks when the
// vault moves, so the scheduler renews anything close to either and reports what
// it did. A dry run answers the same question without granting.
import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { renewSessions } from "@/lib/session-renewal";

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
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || undefined;
  const windowDays = Number(req.nextUrl.searchParams.get("days")) || 7;
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const result = await renewSessions({ chainId, windowDays, dry, force });
  return json({ success: true, ...result });
}

export function GET(req: NextRequest) {
  return loggedCronRun("vault-sessions", () => run(req));
}

export function POST(req: NextRequest) {
  return loggedCronRun("vault-sessions", () => run(req));
}
