import { NextRequest, NextResponse } from "next/server";
import { lendingDefenderAgentCard, lendingDefenderPickPublicOrigin } from "@/lib/reference-lending-defense";

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
  try { request = JSON.parse(raw); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: JSON_HEADERS });
  }
  const id = (request as { id?: unknown })?.id ?? null;
  return NextResponse.json({
    jsonrpc: "2.0", id,
    result: { task: { id: crypto.randomUUID(), status: { state: "completed", timestamp: new Date().toISOString(), message: { role: "agent", kind: "message", messageId: crypto.randomUUID(), parts: [{ kind: "text", text: "Souk Lending Defender acts only inside a funded HireVault hire on BNB Chain. The buyer opens the hire naming this agent's wallet, and the contract holds the deposit inside the floor, drawdown and slippage bounds set at open. This endpoint sells no per-call work and takes no x402 payment." }] } }, artifacts: [{ artifactId: crypto.randomUUID(), name: "lending-defense-result", parts: [{ kind: "data", data: { capability: "health-factor", hire: "vault", readOnly: true } }] }] } },
  }, { headers: JSON_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { ...JSON_HEADERS, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, accept" } });
}
