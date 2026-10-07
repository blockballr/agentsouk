import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { loadStaleTokens } from "@/lib/verifications-store";
import { setDelisted } from "@/lib/delist-store";
import { targetChainId } from "@/lib/types";
import { escrowFunder, releaseEscrowIfDue } from "@/lib/escrow";
import { listRecentPayments } from "@/lib/receipts-store";

export const dynamic = "force-dynamic";

// Maintenance pass: a listing the verifier has read as not-delivered
// continuously for seven days leaves the market. One good probe clears the
// clock, so this never fires on a single bad sweep. It writes the same durable
// delisted row the manual route writes, so the owner relists with a signature
// and lifts it.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function run(): Promise<NextResponse> {
  const stale = await loadStaleTokens(STALE_MS);
  const delisted: string[] = [];
  for (const token of stale) {
    const persisted = await setDelisted(token.tokenId, true, "auto-stale");
    if (persisted) delisted.push(token.tokenId);
  }

  // escrow release pass: recent settled hires whose delivery was verified and
  // whose dispute window has passed are released to the agent. Rows that were
  // never escrowed read as nothing to do, and one RPC failure leaves that row
  // for the next pass rather than stopping the sweep
  const released: string[] = [];
  if (escrowFunder()) {
    const recent = await listRecentPayments(200).catch(() => []);
    for (const payment of recent) {
      if (payment.mode !== "prod") continue;
      try {
        const tx = await releaseEscrowIfDue(payment.paymentId);
        if (tx) released.push(payment.paymentId);
      } catch (e) {
        console.error("[escrow] release sweep row failed:", (e as Error).message);
      }
    }
  }

  return NextResponse.json({
    success: true,
    chainId: targetChainId(),
    windowMs: STALE_MS,
    considered: stale.length,
    delisted,
    released,
    stale: stale.map((t) => ({
      tokenId: t.tokenId,
      name: t.name,
      status: t.status,
      failingSince: t.failingSince,
    })),
  });
}

// The secret gates every verb, so a call without it changes nothing regardless
// of method. That is the real control; the method only decides who can ask.
function refusal(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: "no maintenance secret configured" },
      { status: 503 },
    );
  }
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = refusal(req);
  if (denied) return denied;
  return loggedCronRun("maintenance", run);
}

// The scheduler issues a GET, so this verb runs the same pass. Only a caller
// holding the bearer secret reaches it, which keeps an accidental request from
// delisting anything.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = refusal(req);
  if (denied) return denied;
  return loggedCronRun("maintenance", run);
}
