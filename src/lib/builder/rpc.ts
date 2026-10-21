// the JSON-RPC shapes a built agent's A2A endpoint speaks, the same ones our own agents use,
// so the marketplace, the verifier and any A2A client read its answers without special cases

import { randomUUID } from "node:crypto";
import type { BuiltMessage, BuiltReply } from "./a2a";

export type RpcId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function rpcError(id: RpcId, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// text parts carry the task, and a data part carries the values, bare or under "input"
function readMessage(params: unknown): BuiltMessage | null {
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

export type SendRequest =
  | { ok: true; id: RpcId; message: BuiltMessage }
  | { ok: false; status: number; body: Record<string, unknown> };

// a request body read as one message/send call, or the JSON-RPC refusal to answer it with
export function parseSend(raw: string): SendRequest {
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, body: rpcError(null, -32700, "Parse error: the request body is not valid JSON") };
  }
  if (!isRecord(request)) {
    return { ok: false, status: 400, body: rpcError(null, -32600, "Invalid Request: a JSON-RPC object is required") };
  }
  const id: RpcId = typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return { ok: false, status: 400, body: rpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0" and method must be a string') };
  }
  if (request.method !== "message/send") {
    return { ok: false, status: 200, body: rpcError(id, -32601, `Method not found: ${request.method}`) };
  }
  const message = readMessage(request.params);
  if (!message) {
    return { ok: false, status: 200, body: rpcError(id, -32602, "Invalid params: message/send requires params.message.parts") };
  }
  return { ok: true, id, message };
}

// the agent's words go in status.message and the figures in an artifact, which is where the
// marketplace looks for each
export function sendResult(id: RpcId, reply: BuiltReply, category: string): Record<string, unknown> {
  const taskId = randomUUID();
  return {
    jsonrpc: "2.0",
    id,
    result: {
      task: {
        id: taskId,
        contextId: taskId,
        kind: "task",
        status: {
          state: reply.state,
          timestamp: new Date().toISOString(),
          message: { role: "agent", kind: "message", messageId: randomUUID(), parts: [{ kind: "text", text: reply.text }] },
        },
        artifacts: [{ artifactId: randomUUID(), name: `${category}-result`, parts: [{ kind: "data", data: reply.artifact }] }],
      },
    },
  };
}
