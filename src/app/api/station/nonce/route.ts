import { NextRequest } from "next/server";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { isAddress, stationSignInMessage } from "@/lib/station";
import { stationJson, stationRoute } from "@/lib/station-auth";
import { issueNonce } from "@/lib/station-store";

export const dynamic = "force-dynamic";

// counted by caller only: an address is public, so a count kept on it would let anyone lock a member out
const LIMIT = { table: "rl_station_nonce", limit: 120, windowMs: 60 * 60 * 1000 };

// POST /api/station/nonce
// issued to any address, so the answer never says who is a member
export const POST = stationRoute(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as { address?: unknown } | null;
  if (!isAddress(body?.address)) return stationJson({ success: false, error: "address must be a wallet address" }, 400);
  const address = body.address.toLowerCase();
  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) return stationJson({ success: false, error: "Too many sign-in attempts. Try again later." }, 429);
  } catch {
    return stationJson({ success: false, error: "Sign-in is unavailable just now." }, 503);
  }
  const nonce = await issueNonce(address);
  return stationJson({ success: true, nonce, message: stationSignInMessage(address, nonce) });
});
