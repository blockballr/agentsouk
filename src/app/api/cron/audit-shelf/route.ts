import { NextRequest, NextResponse } from "next/server";
import { loadMarketplaceSnapshot } from "@/lib/scout-curate";
import { saveScoutJson } from "@/lib/scout-pipeline";
import { shelfRefusalReason } from "@/lib/scanner";
import { queryAgents } from "@/lib/scanner";
import { targetChainId } from "@/lib/types";
import { loggedCronRun } from "@/lib/history-store";

export const dynamic = "force-dynamic";

// Self-audit of the shelf: every held entry is re-classified against the
// admission gate, the refused ones are named with their reason, and the gap
// between what passes the gate and what is actually served is counted. Runs
// on a schedule so a working agent that stopped being shown is visible
// without anyone opening the data by hand.
async function run(): Promise<NextResponse> {
  const chainId = targetChainId();
  const snapshot = await loadMarketplaceSnapshot(chainId);
  const held = snapshot?.agents ?? [];

  const buckets: Record<string, number> = {};
  const refused: { tokenId: string; name: string; reason: string }[] = [];
  const suspicious: { tokenId: string; name: string; reason: string }[] = [];
  let admitted = 0;
  for (const agent of held) {
    const reason = shelfRefusalReason(agent);
    if (reason === "") {
      admitted += 1;
      buckets.admitted = (buckets.admitted ?? 0) + 1;
    } else {
      buckets[reason] = (buckets[reason] ?? 0) + 1;
      refused.push({ tokenId: String(agent.token_id), name: agent.name, reason });
      // a verified (delivered) agent that is refused only for category/general
      // is the classifier missing a working agent: surface it separately
      if (reason.startsWith("no category")) {
        suspicious.push({ tokenId: String(agent.token_id), name: agent.name, reason });
      }
    }
  }

  // what is actually served: page through the shelf the way a buyer does
  const served = new Set<string>();
  let page = 1;
  for (;;) {
    const res = await queryAgents({ page, limit: 500 }).catch(() => null);
    if (!res || !res.items || res.items.length === 0) break;
    for (const it of res.items) served.add(String(it.token_id));
    if (res.items.length < 500) break;
    page += 1;
    if (page > 50) break;
  }

  const admittedButNotServed: { tokenId: string; name: string }[] = [];
  for (const agent of held) {
    if (shelfRefusalReason(agent) !== "") continue;
    if (!served.has(String(agent.token_id))) {
      admittedButNotServed.push({ tokenId: String(agent.token_id), name: agent.name });
    }
  }

  const report = {
    at: new Date().toISOString(),
    chainId,
    held: held.length,
    admitted,
    served: served.size,
    refused: refused.length,
    suspicious: suspicious.length,
    admittedButNotServed: admittedButNotServed.length,
    buckets,
    refusedList: refused,
    suspiciousList: suspicious,
    deltaList: admittedButNotServed,
  };

  await saveScoutJson("log-audit-shelf.json", report, chainId);

  return NextResponse.json({
    success: true,
    chainId,
    held: held.length,
    admitted,
    served: served.size,
    refused: refused.length,
    suspicious: suspicious.length,
    admittedButNotServed: admittedButNotServed.length,
    buckets,
  });
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

function refusal(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: "no audit secret configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = refusal(req);
  if (denied) return denied;
  return loggedCronRun("audit-shelf", run);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = refusal(req);
  if (denied) return denied;
  return loggedCronRun("audit-shelf", run);
}
