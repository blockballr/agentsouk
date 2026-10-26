import { NextRequest, NextResponse } from "next/server";
import { lendingDefenderAgentCard, lendingDefenderPickPublicOrigin, LENDING_DEFENDER_NAME } from "@/lib/reference-lending-defense";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

export function GET(): NextResponse {
  const origin = lendingDefenderPickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  return NextResponse.json(lendingDefenderAgentCard(origin), { headers: JSON_HEADERS });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text().catch(() => "");
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: JSON_HEADERS });
  }
  if (!request || typeof request !== "object") {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, { status: 400, headers: JSON_HEADERS });
  }
  const id = (request as { id?: unknown }).id ?? null;
  // For now, return a simple response. Full defense execution will be wired later.
  return NextResponse.json({
    jsonrpc: "2.0",
    id,
    result: {
      task: {
        id: crypto.randomUUID(),
        status: { state: "completed", timestamp: new Date().toISOString(), message: { role: "agent", kind: "message", messageId: crypto.randomUUID(), parts: [{ kind: "text", text: "Souk Lending Defender monitors and defends lending positions on Venus Protocol. Fund a hire through Agent Souk's vault to enable on-chain defense." }] } },
        artifacts: [{ artifactId: crypto.randomUUID(), name: "lending-defense-result", parts: [{ kind: "data", data: { capability: "health-factor", action: "defend-position", status: "ok" } }] }],
      },
    },
  }, { headers: JSON_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { ...JSON_HEADERS, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, accept" } });
}
