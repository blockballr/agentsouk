import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import {
  notificationsFor,
  readAllNotifications,
  readNotification,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/notifications?wallet=0x..
// The wallet's outbox rows, newest first. Read state rides inside each row.
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ success: false, error: "wallet required" }, 400);
  }
  try {
    getAddress(wallet);
  } catch {
    return json({ success: false, error: "wallet required" }, 400);
  }
  const rows = await notificationsFor(getAddress(wallet));
  const unread = rows.filter((r) => !r.read).length;
  return json({ success: true, notifications: rows, unread });
}

// POST /api/notifications  { wallet, id? }
// Marking one row read, or every row when no id is given.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    wallet?: string;
    id?: string;
  } | null;
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return json({ success: false, error: "wallet required" }, 400);
  }
  try {
    getAddress(wallet);
  } catch {
    return json({ success: false, error: "wallet required" }, 400);
  }
  if (typeof body?.id === "string" && body.id) {
    await readNotification(getAddress(wallet), body.id);
  } else {
    await readAllNotifications(getAddress(wallet));
  }
  return json({ success: true });
}
