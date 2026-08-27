import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED = [
  "https://agora-market.vercel.app",
  "https://agora-ai.vercel.app",
  "https://web-eight-rho-8aj9z09r3u.vercel.app",
  "http://localhost:4173",
  "http://localhost:3000",
];

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  const res = NextResponse.next();
  if (origin && ALLOWED.includes(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
  }
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: res.headers });
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
