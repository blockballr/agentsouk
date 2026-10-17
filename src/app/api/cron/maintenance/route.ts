import { NextRequest, NextResponse } from "next/server";
import { loggedCronRun } from "@/lib/history-store";
import { loadStaleTokens, DELIST_WINDOW_MS } from "@/lib/verifications-store";
import { setDelisted } from "@/lib/delist-store";
import { targetChainId } from "@/lib/types";
import { escrowFunder, escrowStatuses, releaseEscrowIfDue } from "@/lib/escrow";
import { listRecentPayments } from "@/lib/receipts-store";
import { emitNotification } from "@/lib/notifications";
import { queryAgents } from "@/lib/scanner";

export const dynamic = "force-dynamic";

// a day without an answer already earns the owner a bell, early enough to fix
// the listing rather than lose it; the daily cadence keeps it to one notice
const WARN_MS = 24 * 60 * 60 * 1000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

// Maintenance pass: a listing the verifier has read as not-delivered
// continuously for the delist window leaves the market. One good probe clears
// the clock, so this never fires on a single bad sweep. It writes the same
// durable delisted row the manual route writes, so the owner relists with a
// signature and lifts it.
async function run(): Promise<NextResponse> {
  const stale = await loadStaleTokens(DELIST_WINDOW_MS);
  const staleIds = new Set(stale.map((t) => t.tokenId));
  const warnOnly = (await loadStaleTokens(WARN_MS)).filter((t) => !staleIds.has(t.tokenId));
  const watched = [...stale, ...warnOnly];
  const warned: string[] = [];
  const delisted: string[] = [];

  // the owner the registry records for each watched token, so whoever listed
  // through us hears about it; a shelf read that fails skips the notices
  // rather than stopping the delist pass
  const watchedIds = new Set(watched.map((t) => t.tokenId));
  const shelf = watchedIds.size
    ? await queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true }).catch(() => null)
    : null;
  const owners = new Map<string, string>();
  for (const item of shelf?.items ?? []) {
    if (
      watchedIds.has(item.token_id) &&
      /^0x[0-9a-f]{40}$/i.test(item.owner_address) &&
      !/^0x0{40}$/i.test(item.owner_address)
    ) {
      owners.set(item.token_id, item.owner_address);
    }
  }

  for (const token of stale) {
    const persisted = await setDelisted(token.tokenId, true, "auto-stale");
    if (!persisted) continue;
    delisted.push(token.tokenId);
    const owner = owners.get(token.tokenId);
    if (!owner) continue;
    // the streak start keys the row, so a rerun writes nothing twice and a
    // failure that returns after a recovery reads as a new event
    await emitNotification({
      wallet: owner,
      kind: "listing_delisted",
      eventKey: `${token.tokenId}-${token.failingSince.replace(/[^0-9]/g, "")}`,
      title: "Listing removed from the shelf",
      body: `${token.name} was read as not answering for seven days, so it left the market. Fix its endpoint and relist to bring it back.`,
      href: "/seller/stalls",
    });
  }

  for (const token of warnOnly) {
    const owner = owners.get(token.tokenId);
    if (!owner) continue;
    await emitNotification({
      wallet: owner,
      kind: "listing_failing",
      eventKey: `${token.tokenId}-${token.failingSince.replace(/[^0-9]/g, "")}`,
      title: "Listing needs a check",
      body: `${token.name} has not answered the marketplace's checks since ${token.failingSince.slice(0, 10)}. One good answer clears it; seven days without one takes the listing off the shelf.`,
      href: `/agents/${targetChainId()}/${token.tokenId}`,
    });
    warned.push(token.tokenId);
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
        if (tx) {
          released.push(payment.paymentId);
          // the buyer learns their money moved from the bell, not by noticing
          // a missing row; the chain read before the release carries the buyer
          const rows = await escrowStatuses([payment.paymentId]).catch(() => []);
          const buyer = rows[0]?.buyer;
          if (buyer) {
            await emitNotification({
              wallet: buyer,
              kind: "escrow_released",
              eventKey: payment.paymentId,
              title: "Escrow released",
              body: `The dispute window passed with no dispute, so the held payment released to the agent. Transaction ${tx}.`,
              href: "/ongoing",
              txHash: tx,
            });
          }
        }
      } catch (e) {
        console.error("[escrow] release sweep row failed:", (e as Error).message);
      }
    }
  }

  return NextResponse.json({
    success: true,
    chainId: targetChainId(),
    windowMs: DELIST_WINDOW_MS,
    considered: stale.length,
    delisted,
    warned,
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
