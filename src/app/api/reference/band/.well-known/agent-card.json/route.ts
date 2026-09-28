import { NextRequest, NextResponse } from "next/server";
import { bandAgentCard, bandPickPublicOrigin } from "@/lib/reference-band";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

export function GET(req: NextRequest): NextResponse {
  let requestOrigin: string | null = null;
  try {
    requestOrigin = new URL(req.url).origin;
  } catch {
    requestOrigin = null;
  }
  const origin = bandPickPublicOrigin([
    process.env.PUBLIC_API_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    requestOrigin,
  ]);
  return NextResponse.json(bandAgentCard(origin), { headers: JSON_HEADERS });
}
