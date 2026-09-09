import "server-only";

import { fetchAgentDetail } from "@/lib/scanner";
import { getPaymentDurable } from "./receipts-store";

// the delivery half of hire: a settled receipt unlocks invoking the agent's
// own endpoint. two protocols exist in the wild today, both JSON-RPC over HTTP:
// MCP (initialize, tools/list, tools/call) and A2A (agent card, message/send)
// agents that gate direct calls behind their own x402 payment get surfaced as
// gated rather than faked

const HTTP_TIMEOUT_MS = 20000;

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function postRpc(
  url: string,
  body: RpcRequest,
  headers: Record<string, string> = {},
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<{ status: number; contentType: string; body: RpcResponse; sessionId: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    return { status: res.status, contentType, body: parseRpc(raw, contentType), sessionId: res.headers.get("mcp-session-id") };
  } finally {
    clearTimeout(timer);
  }
}

// streamable HTTP MCP servers may answer with SSE; the payload we want is in
// the last parseable data line
function parseRpc(raw: string, contentType: string): RpcResponse {
  if (contentType.includes("text/event-stream")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i].slice(5).trim()) as RpcResponse;
      } catch {
        // keep scanning backwards
      }
    }
    return { error: { code: -32000, message: "unparseable SSE response" } };
  }
  try {
    return JSON.parse(raw) as RpcResponse;
  } catch {
    return { error: { code: -32000, message: `non-JSON response: ${raw.slice(0, 120)}` } };
  }
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// one stateless round trip per call; the servers observed in the index do not
// require a session, but honour the header when issued
async function mcpCall(
  endpoint: string,
  method: string,
  params: unknown | undefined,
  sessionFromInit: string | null,
  isNotification = false,
): Promise<{ status: number; body: RpcResponse; sessionId: string | null }> {
  const headers: Record<string, string> = {};
  if (sessionFromInit) headers["mcp-session-id"] = sessionFromInit;
  const req: RpcRequest = { jsonrpc: "2.0", method, ...(isNotification ? {} : { id: Date.now() % 100000 }) };
  if (params !== undefined) req.params = params;
  return postRpc(endpoint, req, headers);
}

async function deliverMcp(
  endpoint: string,
  tool?: string,
  args?: Record<string, unknown>,
): Promise<DeliverOutcome> {
  const init = await mcpCall(endpoint, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agora-marketplace", version: "0.1.0" },
  }, null);
  if (init.body.error) {
    return { protocol: "mcp", ok: false, error: `initialize failed: ${init.body.error.message}` };
  }
  const sessionId = init.sessionId;
  if (sessionId) {
    await mcpCall(endpoint, "notifications/initialized", undefined, sessionId, true);
  }

  if (!tool) {
    const list = await mcpCall(endpoint, "tools/list", {}, sessionId);
    if (list.body.error) {
      return { protocol: "mcp", ok: false, error: `tools/list failed: ${list.body.error.message}` };
    }
    const tools = (list.body.result?.tools ?? []) as McpTool[];
    return {
      protocol: "mcp",
      ok: true,
      kind: "capabilities",
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        schema: t.inputSchema ?? {},
      })),
    };
  }

  const call = await mcpCall(endpoint, "tools/call", { name: tool, arguments: args ?? {} }, sessionId);
  if (call.body.error) {
    return { protocol: "mcp", ok: false, error: `tools/call failed: ${call.body.error.message}` };
  }
  const result = call.body.result ?? {};
  const content = (result.content as { type?: string; text?: string }[] | undefined) ?? [];
  const text = content
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
  return {
    protocol: "mcp",
    ok: true,
    kind: "deliverable",
    text: text || `tool ${tool} returned no text content`,
    isError: result.isError === true,
  };
}

interface AgentCard {
  url?: string;
  supportedInterfaces?: { url: string }[];
}

async function deliverA2a(endpoint: string, task: string): Promise<DeliverOutcome> {
  // the registry's a2a_endpoint usually points at the agent card; the messaging
  // url lives inside it
  let messagingUrl = endpoint;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    const cardRes = await fetch(endpoint, { headers: { accept: "application/json" }, signal: ctl.signal }).finally(() =>
      clearTimeout(timer),
    );
    const card = (await cardRes.json()) as AgentCard;
    const fromCard = card.supportedInterfaces?.[0]?.url ?? card.url;
    if (fromCard) messagingUrl = fromCard;
  } catch {
    // not a card; treat the registered endpoint as the messaging url directly
  }

  const send = await postRpc(messagingUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        kind: "message",
        messageId: `agora-${Date.now()}`,
        parts: [{ kind: "text", text: task }],
      },
    },
  });

  if (send.status === 402) {
    return {
      protocol: "a2a",
      ok: false,
      gated: true,
      error:
        "This agent gates direct calls behind its own x402 payment; the session receipt covers the marketplace hire but not the agent's per-call fee.",
    };
  }
  if (send.body.error) {
    return { protocol: "a2a", ok: false, error: `message/send failed: ${send.body.error.message}` };
  }

  const result = send.body.result as { parts?: { kind?: string; text?: string }[] } | undefined;
  const parts = result?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
  return { protocol: "a2a", ok: true, kind: "deliverable", text: text || JSON.stringify(send.body.result ?? {}).slice(0, 400) };
}

export interface DeliverOutcome {
  protocol: "mcp" | "a2a";
  ok: boolean;
  kind?: "capabilities" | "deliverable";
  text?: string;
  gated?: boolean;
  isError?: boolean;
  error?: string;
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
}

export interface DeliverInput {
  paymentId: string;
  tool?: string;
  args?: Record<string, unknown>;
  task?: string;
}

export async function deliver(input: DeliverInput): Promise<
  | (DeliverOutcome & { agent: { chainId: number; tokenId: string; name: string }; paymentId: string })
  | { ok: false; error: string }
> {
  const receipt = await getPaymentDurable(input.paymentId);
  if (!receipt || !receipt.activated) {
    return { ok: false, error: "No settled session for this payment id. Hire the agent first." };
  }

  const detail = await fetchAgentDetail(receipt.agent.chainId, receipt.agent.tokenId);
  if (!detail) {
    return { ok: false, error: "Agent left the registry since the hire." };
  }

  let outcome: DeliverOutcome;
  if (detail.mcp_server) {
    outcome = await deliverMcp(detail.mcp_server, input.tool, input.args);
  } else if (detail.a2a_endpoint) {
    if (!input.task) {
      // no task yet: report the protocol so the client can ask for one
      outcome = { protocol: "a2a", ok: true, kind: "capabilities", tools: [] };
    } else {
      outcome = await deliverA2a(detail.a2a_endpoint, input.task);
    }
  } else {
    return {
      ok: false,
      error:
        "This agent has no callable endpoint registered (no MCP server, no A2A endpoint), so settlement can be recorded but nothing can be delivered.",
    };
  }

  return {
    ...outcome,
    agent: { chainId: receipt.agent.chainId, tokenId: receipt.agent.tokenId, name: receipt.agent.name },
    paymentId: input.paymentId,
  };
}
