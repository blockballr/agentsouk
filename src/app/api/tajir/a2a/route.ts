import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  TAJIR_AGENT_CATEGORY,
  TAJIR_AGENT_NAME,
  tajirAgentTokenId,
} from "@/lib/tajir-agent";
import { decideGridAgentTask, type GridAgentReply } from "@/lib/reference-grid";
import { decideGridAgentTaskLive } from "@/lib/reference-grid-live";
import { sellerConfigFromEnv, sellerHook } from "@/lib/seller8183";
import { targetChainId } from "@/lib/types";
import { legacyGate } from "@/lib/legacy-gate";

export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
};

// The house seller's kit pointed at this listing: the token id is this agent's
// registry id once minted, and the _TAJIR suffix lets this listing carry its own
// provider wallet, key and price beside the house agent's when set, falling back
// to the shared seller envs when it does not
const SELLER8183 = sellerConfigFromEnv(targetChainId(), tajirAgentTokenId(targetChainId()), TAJIR_AGENT_NAME, "_TAJIR");

type RpcId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rpcId(value: unknown): RpcId {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function rpcError(id: RpcId, code: number, message: string, httpStatus = 200): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: httpStatus, headers: JSON_HEADERS },
  );
}

interface MessagePayload {
  task: string;
  input?: Record<string, unknown>;
}

// A2A parts carry the task text in text parts and a structured payload in a data
// part of the form { input: {...} }, which is what our own client sends. A benign
// status question with no input still yields a payload, so it is answered rather
// than refused.
function readMessage(params: unknown): MessagePayload | null {
  if (!isRecord(params)) return null;
  const message = params.message;
  if (!isRecord(message) || !Array.isArray(message.parts)) return null;
  const texts: string[] = [];
  let input: Record<string, unknown> | undefined;
  for (const part of message.parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string" && part.text.trim()) texts.push(part.text.trim());
    else if (isRecord(part.data)) {
      const payload = isRecord(part.data.input) ? part.data.input : part.data;
      input = { ...(input ?? {}), ...payload };
    }
  }
  return { task: texts.join("\n"), input };
}

// The marketplace extracts the agent's words from status.message.parts and the
// payload from artifacts, so both carry the same computed answer. The state is
// completed for an answer and input-required when a value is missing.
function taskEnvelope(reply: GridAgentReply): Record<string, unknown> {
  const taskId = randomUUID();
  return {
    id: taskId,
    contextId: taskId,
    kind: "task",
    status: {
      state: reply.state,
      timestamp: new Date().toISOString(),
      message: {
        role: "agent",
        kind: "message",
        messageId: randomUUID(),
        parts: [{ kind: "text", text: reply.text }],
      },
    },
    artifacts: [
      {
        artifactId: randomUUID(),
        name: `${TAJIR_AGENT_CATEGORY}-result`,
        parts: [{ kind: "data", data: reply.artifact }],
      },
    ],
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = legacyGate(req);
  if (gate) return gate;
  const raw = await req.text().catch(() => "");
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error: the request body is not valid JSON", 400);
  }
  if (!isRecord(request)) {
    return rpcError(null, -32600, "Invalid Request: a JSON-RPC object is required", 400);
  }
  const id = rpcId(request.id);
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return rpcError(
      id,
      -32600,
      'Invalid Request: jsonrpc must be "2.0" and method must be a string',
      400,
    );
  }
  if (request.method !== "message/send") {
    return rpcError(id, -32601, `Method not found: ${request.method}`);
  }
  const message = readMessage(request.params);
  if (!message) {
    return rpcError(id, -32602, "Invalid params: message/send requires params.message.parts");
  }

  // The seller-side ERC-8183 steps ride the same endpoint: a negotiate or
  // notify_funded data part answers at result level, never a task envelope, so
  // the marketplace's quote and notify readers do not trip on a task wrapper.
  // The funded job's description carries the ladder's own numbers, so the work
  // step plans from it directly rather than reading a pool.
  const rawParts =
    isRecord(request.params) && isRecord(request.params.message) && Array.isArray(request.params.message.parts)
      ? request.params.message.parts
      : [];
  const seller = await sellerHook(SELLER8183, rawParts, (task) => {
    const reply = decideGridAgentTask(task, message.input);
    return { text: reply.text };
  });
  if (seller.kind !== "none") {
    return NextResponse.json(
      { jsonrpc: "2.0", id, result: seller.envelope },
      { headers: JSON_HEADERS },
    );
  }

  // a named PancakeSwap pair reads the pool first; any other request is the plain planner
  const reply = await decideGridAgentTaskLive(message.task, message.input);
  return NextResponse.json(
    { jsonrpc: "2.0", id, result: { task: taskEnvelope(reply) } },
    { headers: JSON_HEADERS },
  );
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, accept",
    },
  });
}

// The agent is a stateless request/response endpoint, so it holds no session and
// no server-push stream; GET is refused with an Allow header.
export function GET(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "This A2A endpoint is stateless: send JSON-RPC with POST." },
    },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST, OPTIONS" } },
  );
}



