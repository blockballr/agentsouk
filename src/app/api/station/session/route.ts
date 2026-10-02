import { NextRequest } from "next/server";
import { verifyMessage } from "viem";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { isAddress, isNonce, stationSignInMessage } from "@/lib/station";
import { bearerToken, stationJson, stationRoute } from "@/lib/station-auth";
import { closeSessions, getMember, openSession, recordAudit, sessionAddress, spendNonce } from "@/lib/station-store";

export const dynamic = "force-dynamic";

// counted by caller only, for the same reason as the nonce
const LIMIT = { table: "rl_station_session", limit: 60, windowMs: 60 * 60 * 1000 };
// an address, a nonce and a signature fit in a fraction of this
const MAX_BODY = 4_000;
const REFUSED = "That sign-in was not accepted. Ask for a new one and sign it with a member's wallet.";

// POST /api/station/session
// every refusal reads the same, so a caller cannot tell why it was refused
export const POST = stationRoute(async (req: NextRequest) => {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return stationJson({ success: false, error: "the request body is too large" }, 413);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const body = parsed as { address?: unknown; nonce?: unknown; signature?: unknown } | null;
  if (!isAddress(body?.address) || typeof body.nonce !== "string" || typeof body.signature !== "string") {
    return stationJson({ success: false, error: "address, nonce and signature are required" }, 400);
  }
  const address = body.address.toLowerCase();
  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) return stationJson({ success: false, error: "Too many sign-in attempts. Try again later." }, 429);
  } catch {
    return stationJson({ success: false, error: "Sign-in is unavailable just now." }, 503);
  }

  // the nonce is spent before anything else is looked at, so it can never be tried twice
  const fresh = isNonce(body.nonce) && (await spendNonce(body.nonce, address));
  const signed =
    fresh &&
    (await verifyMessage({
      address: address as `0x${string}`,
      message: stationSignInMessage(address, body.nonce),
      signature: body.signature as `0x${string}`,
    }).catch(() => false));
  const member = signed ? await getMember(address) : undefined;
  if (!member) return stationJson({ success: false, error: REFUSED }, 401);

  const session = await openSession(address);
  await recordAudit(address, "signed in");
  return stationJson({ success: true, session: { token: session.token, address, role: member.role, expiresAt: session.expiresAt } });
});

// DELETE /api/station/session
// ends the caller's session, or with all set, every session their wallet has open
export const DELETE = stationRoute(async (req: NextRequest) => {
  const token = bearerToken(req);
  const address = token ? await sessionAddress(token) : undefined;
  // a session that is already over has nothing left to end
  if (!address) return stationJson({ success: true });
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return stationJson({ success: false, error: "the request body is too large" }, 413);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const body = parsed as { all?: unknown } | null;
  const all = body?.all === true;
  await closeSessions(token, address, all);
  await recordAudit(address, all ? "signed out everywhere" : "signed out");
  return stationJson({ success: true });
});
