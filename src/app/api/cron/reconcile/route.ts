import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { loggedCronRun } from "@/lib/history-store";
import {
  getPaymentDurable,
  listUnresolvedSettlements,
  recordPaymentDurable,
  resolvePendingSettlement,
  type PendingSettlement,
} from "@/lib/receipts-store";
import type { StoredPayment } from "@/lib/x402";
import { rpcTransport } from "@/lib/rpc";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// a row is only read once the settle request that wrote it has had time to finish its
// own wait for the receipt, so a healthy settlement is never raced by its own sweep
const SETTLE_GRACE_MS = 2 * 60_000;
const MAX_ROWS = 25;
// mirrors the window settleProd grants, so a reconciled session is what a hire settled
// on the happy path would have been given
const SESSION_MS = 24 * 60 * 60 * 1000;

// A payment window that elapsed while the settlement went unrecorded would hand the
// buyer a receipt for a hire they cannot run, so the window restarts at the moment the
// record is actually made. The payment time is left alone: that is when the money moved,
// and rewriting it would misdate the transfer the chain already holds.
function restartLapsedSession(payload: StoredPayment): { payload: StoredPayment; restarted: boolean } {
  const expiresAt = Date.parse(payload.session?.expiresAt ?? "");
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
    return { payload, restarted: false };
  }
  return {
    payload: {
      ...payload,
      session: {
        ...payload.session,
        expiresAt: new Date(Date.now() + SESSION_MS).toISOString(),
      },
    },
    restarted: true,
  };
}

// the chain is the only authority on whether a broadcast moved money, and a hash this
// sweep has not seen mined yet is not a no: it answers null and the row stays open
async function readTxReceipt(row: PendingSettlement) {
  const chain = row.chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
  const client = createPublicClient({ chain, transport: rpcTransport(row.chainId) });
  return client.getTransactionReceipt({ hash: row.txHash as `0x${string}` }).catch(() => null);
}

// GET /api/cron/reconcile - finishes the records that a settlement timeout prevented.
// A relay broadcast whose wait for its receipt timed out leaves the funds moved with no
// receipt and no session. The hash is saved at broadcast time, and this reads it back:
// mined and successful writes the record the buyer paid for, reverted closes the row
// with nothing written, and not yet mined leaves it for the next pass.
export function GET(req: NextRequest) {
  return loggedCronRun("reconcile", () => run(req));
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ success: false, error: "reconcile sweep is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const rows = await listUnresolvedSettlements(MAX_ROWS);
  const now = Date.now();
  const counts = { recorded: 0, reverted: 0, alreadyRecorded: 0, stillPending: 0, sessionsRestarted: 0 };
  const results: { paymentId: string; txHash: string; outcome: string }[] = [];

  for (const row of rows) {
    const writtenAt = Date.parse(row.payload.createdAt ?? "");
    if (Number.isFinite(writtenAt) && now - writtenAt < SETTLE_GRACE_MS) {
      counts.stillPending += 1;
      continue;
    }

    // the request that wrote this row may have finished its own wait after all, so the
    // receipt is already there. Closing the row without a chain read keeps the sweep
    // from ever writing the same payment twice
    if (await getPaymentDurable(row.paymentId)) {
      await resolvePendingSettlement(row.paymentId, "recorded");
      counts.alreadyRecorded += 1;
      continue;
    }

    const receipt = await readTxReceipt(row);
    if (!receipt) {
      counts.stillPending += 1;
      results.push({ paymentId: row.paymentId, txHash: row.txHash, outcome: "still-pending" });
      continue;
    }
    if (receipt.status !== "success") {
      await resolvePendingSettlement(row.paymentId, "reverted");
      counts.reverted += 1;
      results.push({ paymentId: row.paymentId, txHash: row.txHash, outcome: "reverted" });
      continue;
    }

    const { payload, restarted } = restartLapsedSession(row.payload);
    if (restarted) counts.sessionsRestarted += 1;
    await recordPaymentDurable(payload);
    await resolvePendingSettlement(row.paymentId, "recorded");
    counts.recorded += 1;
    results.push({ paymentId: row.paymentId, txHash: row.txHash, outcome: "recorded" });
  }

  return NextResponse.json({
    success: true,
    considered: rows.length,
    counts,
    results,
  });
}
