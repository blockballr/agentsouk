import { NextRequest, NextResponse } from "next/server";

// apps/web is deployed separately and calls /api cross-origin
// WEB_ORIGIN is a comma-separated allowlist; the wildcard only when unset
// the response echoes the request origin so credentials stay impossible and
// multiple preview origins can be allowed explicitly
// the site's own origins are always allowed, so a partial WEB_ORIGIN on a
// deployment cannot cut the site off from its API
const SITE_ORIGINS = [
  "https://agentsouk.xyz",
  "https://www.agentsouk.xyz",
  "https://agentsouk.pages.dev",
  "https://station.agentsouk.xyz",
  "https://docs.agentsouk.xyz",
];

// a branch preview of our own Pages project, such as ui-uplift.agentsouk.pages.dev;
// only that project can serve names under it, and the anchors refuse lookalikes
const PAGES_PREVIEW = /^https:\/\/[a-z0-9-]+\.agentsouk\.pages\.dev$/;

const ALLOWED = [
  ...(process.env.WEB_ORIGIN ?? "*").split(","),
  ...SITE_ORIGINS,
]
  .map((o) => o.trim())
  .filter(Boolean);

// drop obvious scanners: a user agent that names a crawler or a path that
// probes well-known endpoints the api does not serve. These are cheap 404s
// but they still cost a function invocation, so short-circuit them here.
const BOT_UA = /bot|crawl|spider|scan|slurp|fetcher|httpclient|python-requests|curl|wget/i;
const PROBE_PATH = /\/\.well-known\/|\/agent\.json|\/agent-provider\.json/i;

export function proxy(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  const path = req.nextUrl.pathname;
  if (BOT_UA.test(ua) && PROBE_PATH.test(path)) {
    return new NextResponse(null, { status: 404 });
  }
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (allow) headers["Access-Control-Allow-Origin"] = allow;
  if (allow && allow !== "*") headers["Vary"] = "Origin";
  return headers;
}

export const config = {
  matcher: "/api/:path*",
};
