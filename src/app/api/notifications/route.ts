import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import {
  dismissNotification,
  notificationsFor,
  readAllNotifications,
  readNotification,
} from "@/lib/notifications";
import { proofFromHeaders, verifyWalletProof } from "@/lib/wallet-proof";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// A feed is private to its wallet, so the caller has to prove it holds the key.
// The proof is the app's signed sign-in statement, replayed in headers.
async function proven(req: NextRequest, wallet: string): Promise<boolean> {
  const { message, signature } = proofFromHeaders(req.headers);
  return verifyWalletProof({ wallet, message, signature });
}

// GET /api/notifications?wallet=0x..
// The wallet's outbox rows, newest first. Read state rides inside each row.
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ success: false, error: "wallet required" }, 400);
  }
  let checksummed: string;
  try {
    checksummed = getAddress(wallet);
  } catch {
    return json({ success: false, error: "wallet required" }, 400);
  }
  if (!(await proven(req, checksummed))) {
    return json({ success: false, error: "sign in with this wallet to read its notifications" }, 401);
  }
  const rows = await notificationsFor(checksummed);
  const unread = rows.filter((r) => !r.read).length;
  return json({ success: true, notifications: rows, unread });
}

// POST /api/notifications  { wallet, id?, dismiss? }
// Marking one row read, or every row when no id is given. dismiss removes the
// row instead, so the bell's clear action survives the next poll.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    id?: string;
    dismiss?: boolean;
  } | null;
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ success: false, error: "wallet required" }, 400);
  }
  let checksummed: string;
  try {
    checksummed = getAddress(wallet);
  } catch {
    return json({ success: false, error: "wallet required" }, 400);
  }
  if (!(await proven(req, checksummed))) {
    return json({ success: false, error: "sign in with this wallet to change its notifications" }, 401);
  }
  if (body?.dismiss === true) {
    await dismissNotification(checksummed, typeof body.id === "string" && body.id ? body.id : undefined);
    return json({ success: true });
  }
  if (typeof body?.id === "string" && body.id) {
    await readNotification(checksummed, body.id);
  } else {
    await readAllNotifications(checksummed);
  }
  return json({ success: true });
}
