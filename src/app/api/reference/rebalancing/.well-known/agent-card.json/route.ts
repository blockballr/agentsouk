import { NextResponse } from "next/server";
import { pickPublicOrigin, referenceAgentCard } from "@/lib/reference-rebalancing";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

// The public agent card. A configured public origin is used when it survives the
// marketplace's private-address check; otherwise the deployed api origin is used,
// so the messaging url the card names is never a private or loopback address.
export function GET(): NextResponse {
  const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  return NextResponse.json(referenceAgentCard(origin), { headers: JSON_HEADERS });
}
