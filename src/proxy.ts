import { NextRequest, NextResponse } from "next/server";

// apps/web is deployed separately and calls /api cross-origin
// WEB_ORIGIN is a comma-separated allowlist; the wildcard only when unset
// the response echoes the request origin so credentials stay impossible and
// multiple preview origins can be allowed explicitly
// the site's own origins are always allowed, so a partial WEB_ORIGIN on a
// deployment cannot cut the site off from its API
const SITE_ORIGINS = ["https://agentsouk.xyz", "https://www.agentsouk.xyz", "https://agentsouk.pages.dev"];

// a branch preview of our own Pages project, such as ui-uplift.agentsouk.pages.dev;
// only that project can serve names under it, and the anchors refuse lookalikes
const PAGES_PREVIEW = /^https:\/\/[a-z0-9-]+\.agentsouk\.pages\.dev$/;

const ALLOWED = [
  ...(process.env.WEB_ORIGIN ?? "*").split(","),
  ...SITE_ORIGINS,
]
  .map((o) => o.trim())
  .filter(Boolean);

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED.includes("*")
    ? "*"
    : ALLOWED.includes(origin) || PAGES_PREVIEW.test(origin)
      ? origin
      : null;
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(allow) });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(allow))) res.headers.set(k, v);
  return res;
}

// revoke and relist are DELETE requests, and a day-long preflight cache keeps
// a busy page from paying one extra request per write
export function corsHeaders(allow: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (allow) headers["Access-Control-Allow-Origin"] = allow;
  if (allow && allow !== "*") headers["Vary"] = "Origin";
  return headers;
}

export const config = {
  matcher: "/api/:path*",
};
