import { NextRequest, NextResponse } from "next/server";
import { answerBuiltAgent } from "@/lib/builder/a2a";
import { parseSend, rpcError, sendResult } from "@/lib/builder/rpc";
import { liveReader } from "@/lib/builder/sources";
import { getBuiltAgent } from "@/lib/builder/store";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = { table: "rl_built_a2a", limit: 60, windowMs: 60 * 1000 };
const MAX_BODY = 20_000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};
const answer = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: JSON_HEADERS });

// POST /api/built/<id>/a2a
// one message/send call, answered by running the agent's blueprint on the caller's values
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return answer(rpcError(null, -32600, "Invalid Request: the body is too large"), 413);
  const send = parseSend(raw);
  if (!send.ok) return answer(send.body, send.status);

  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) return answer(rpcError(send.id, -32000, "Too many requests. Try again in a minute."), 429);
    const built = await getBuiltAgent(id);
    if (!built) return answer(rpcError(send.id, -32001, "No agent is hosted at this address."), 404);
    const reply = await answerBuiltAgent(built.blueprint, send.message, { read: liveReader(targetChainId()) });
    return answer(sendResult(send.id, reply, built.blueprint.category));
  } catch (e) {
    console.error("[built] not answered", id, e instanceof Error ? e.message : String(e));
    return answer(rpcError(send.id, -32603, "The agent could not answer just now."), 503);
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { ...JSON_HEADERS, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, accept" },
  });
}

// the endpoint holds no session and no stream, so there is nothing to GET
export function GET(): NextResponse {
  return answer(rpcError(null, -32600, "This A2A endpoint is stateless: send JSON-RPC with POST."), 405);
}
