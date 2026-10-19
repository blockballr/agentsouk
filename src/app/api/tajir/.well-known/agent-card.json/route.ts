import { NextRequest, NextResponse } from "next/server";
import { tajirAgentCard, pickTajirOrigin } from "@/lib/tajir-agent";
import { legacyGate } from "@/lib/legacy-gate";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

// The public agent card. A configured public origin is used when it survives the
// marketplace's private-address check; otherwise the deployed api origin is used,
// so the messaging url the card names is never a private or loopback address.
export function GET(req: NextRequest): NextResponse {
  const gate = legacyGate(req);
  if (gate) return gate;
  const origin = pickTajirOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  return NextResponse.json(tajirAgentCard(origin), { headers: JSON_HEADERS });
}




