import { NextRequest, NextResponse } from "next/server";
import { answerBuiltAgent, builtAgentCard } from "@/lib/builder/a2a";
import { parseSend, rpcError, sendResult } from "@/lib/builder/rpc";
import { liveReader } from "@/lib/builder/sources";
import { getBuiltAgent } from "@/lib/builder/store";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { targetChainId } from "@/lib/types";
import { sellerConfigFromEnv, isNegotiateData, isNotifyData, quoteEnvelope, verifyNotify, submitDeliverable } from "@/lib/seller8183";
import { kernelJob } from "@/lib/jobs8183";
import { builtSellerConfig, isRevoked } from "@/lib/builder/keys";

export const dynamic = "force-dynamic";

const LIMIT = { table: "rl_built_a2a", limit: 60, windowMs: 60 * 1000 };
const MAX_BODY = 20_000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};
const answer = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: JSON_HEADERS });

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

    const hireMode = built.blueprint.hireMode ?? "direct";

    let parts: unknown[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.params?.message?.parts) parts = parsed.params.message.parts;
    } catch { /* ignore */ }

    if (hireMode === "job" || hireMode === "both") {
      if (!(await isRevoked(id))) {
        const cfg = (await builtSellerConfig(id, built.blueprint.name, targetChainId())) ??
          sellerConfigFromEnv(targetChainId(), null, built.blueprint.name, "");

        for (const part of Array.isArray(parts) ? parts : []) {
          if (!part || typeof part !== "object") continue;
          const data = (part as { data?: unknown }).data;
          if (!data || typeof data !== "object") continue;
          if (isNegotiateData(data)) {
            const q = await quoteEnvelope(cfg, data as Record<string, unknown> & { skill: string });
            if (q.ok) return answer(q.envelope as unknown as Record<string, unknown>, 200);
            return answer({ jsonrpc: "2.0", id: send.id, status: q.status, unsigned_reason: q.unsigned_reason } as Record<string, unknown>, 200);
          }
          if (isNotifyData(data)) {
            const v = await verifyNotify(cfg, data as { skill: string; job_id: unknown }, kernelJob);
            if (!v.ok) return answer({ jsonrpc: "2.0", id: send.id, status: "refused", unsigned_reason: v.reason } as Record<string, unknown>, 200);
            const reply = await answerBuiltAgent(built.blueprint, { task: v.description, input: send.message.input }, { read: liveReader(targetChainId()) });
            const submitted = await submitDeliverable(cfg, v.jobId, { content: reply.text, contentType: "text/plain", metadata: { agent: cfg.agentName } });
            if (!submitted.ok) return answer({ jsonrpc: "2.0", id: send.id, status: "refused", unsigned_reason: `the deliverable was not submitted: ${submitted.reason}` } as Record<string, unknown>, 200);
            return answer({ jsonrpc: "2.0", id: send.id, status: "acknowledged", job_id: v.jobId.toString(), submit_tx: submitted.txHash, deliverable_url: submitted.deliverableUrl } as Record<string, unknown>, 200);
          }
        }
      }
    }

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

export function GET(): NextResponse {
  return answer(rpcError(null, -32600, "This A2A endpoint is stateless: send JSON-RPC with POST."), 405);
}
