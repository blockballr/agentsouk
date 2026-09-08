import { NextRequest, NextResponse } from "next/server";

// apps/web is deployed separately and calls /api cross-origin
// WEB_ORIGIN is a comma-separated allowlist; the wildcard only when unset
// the response echoes the request origin so credentials stay impossible and
// multiple preview origins can be allowed explicitly
const ALLOWED = (process.env.WEB_ORIGIN ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED.includes("*")
    ? "*"
    : ALLOWED.includes(origin)
      ? origin
      : null;
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(allow) });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(allow))) res.headers.set(k, v);
  return res;
}

function corsHeaders(allow: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (allow) headers["Access-Control-Allow-Origin"] = allow;
  return headers;
}

export const config = {
  matcher: "/api/:path*",
};
