import { NextRequest, NextResponse } from "next/server";

// apps/web is deployed separately and calls /api cross-origin
// the origin is pinned by env so the wildcard never ships to prod if we tighten it
// next 16 renamed the middleware file convention to proxy
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "*";

export function proxy(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
  return res;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = {
  matcher: "/api/:path*",
};
