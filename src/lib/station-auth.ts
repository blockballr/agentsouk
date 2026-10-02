// the one check every team panel route makes
// membership is read on every request, so removing someone takes effect at once

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { roleAllows, type StationMember, type StationRole } from "./station";
import { getMember, sessionAddress } from "./station-store";

export const NO_STORE = { "cache-control": "no-store" } as const;

export function stationJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function bearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export type MemberCheck = { member: StationMember; refusal?: undefined } | { member?: undefined; refusal: NextResponse };

export async function requireMember(req: NextRequest, need: StationRole = "viewer"): Promise<MemberCheck> {
  const token = bearerToken(req);
  if (!token) return { refusal: stationJson({ success: false, error: "Sign in to the station." }, 401) };
  const address = await sessionAddress(token);
  if (!address) return { refusal: stationJson({ success: false, error: "This session has ended. Sign in again." }, 401) };
  const member = await getMember(address);
  if (!member) return { refusal: stationJson({ success: false, error: "This wallet is not a member of the station." }, 403) };
  if (!roleAllows(member.role, need)) {
    return { refusal: stationJson({ success: false, error: `This needs the ${need} role. Yours is ${member.role}.` }, 403) };
  }
  return { member };
}

// a store that cannot be read refuses the request; it never answers from somewhere else
export function stationRoute(handler: (req: NextRequest) => Promise<NextResponse>): (req: NextRequest) => Promise<NextResponse> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      console.error("[station]", req.method, req.nextUrl.pathname, e instanceof Error ? e.message : String(e));
      return stationJson({ success: false, error: "The station cannot be reached just now. Try again in a minute." }, 503);
    }
  };
}
