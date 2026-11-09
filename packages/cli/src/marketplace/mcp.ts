import { CliError } from "../core/errors";
import type { CliConfig } from "../core/config";
import { showAgent } from "./agents";
import { assertCallableEndpoint, textFromResult } from "./call";

// The MCP half of the same direct-call rule: the card names the server, the CLI
// speaks JSON-RPC to it, and the marketplace never relays the call. Streamable
// HTTP answers either one JSON message or an event stream, so both are read.

const MCP_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "agentsouk-cli", version: "0.1.0" };

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpRpc {
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function parseMcpRpc(text: string, contentType: string): McpRpc {
  if (contentType.includes("text/event-stream")) {
    let last: McpRpc | null = null;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as unknown;
        if (parsed && typeof parsed === "object") last = parsed as McpRpc;
      } catch {
        // an SSE comment or partial line is not an answer
      }
    }
    if (!last) throw new CliError("the MCP server returned no JSON event", "call_failed");
    return last;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new CliError("the MCP server returned no JSON object", "call_failed");
    }
    return parsed as McpRpc;
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError("the MCP server returned non-JSON", "call_failed");
  }
}

export function parseMcpArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("--args must be a JSON object", "bad_args");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("--args must be a JSON object", "bad_args");
  }
  return parsed as Record<string, unknown>;
}

interface RpcAnswer {
  result: unknown;
  sessionId: string | null;
}

async function post(
  url: URL,
  body: Record<string, unknown>,
  sessionId: string | null,
  timeoutMs: number,
): Promise<RpcAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_VERSION,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`cannot reach ${url.toString()}: ${reason}`, "network");
  } finally {
    clearTimeout(timer);
  }
  const session = response.headers.get("mcp-session-id") ?? sessionId;
  const text = await response.text();
  const rpc = parseMcpRpc(text, response.headers.get("content-type") ?? "");
  if (!response.ok) {
    throw new CliError(
      `${url.toString()} answered ${response.status}: ${rpc.error?.message ?? response.statusText}`,
      "call_failed",
    );
  }
  if (rpc.error) {
    throw new CliError(`the MCP server returned an error: ${rpc.error.message ?? "unknown"}`, "call_failed");
  }
  return { result: rpc.result, sessionId: session };
}

async function open(url: URL, timeoutMs: number): Promise<string | null> {
  const init = await post(
    url,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    },
    null,
    timeoutMs,
  );
  if (init.sessionId) {
    // the notification is the second half of the handshake; a server that does
    // not need it answers 202 or ignores it, so a failure here is not fatal
    await post(
      url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      init.sessionId,
      Math.min(timeoutMs, 10_000),
    ).catch(() => undefined);
  }
  return init.sessionId;
}

async function serverFor(config: CliConfig, chainId: number, tokenId: string): Promise<{ agent: Awaited<ReturnType<typeof showAgent>>; url: URL }> {
  const agent = await showAgent(config, chainId, tokenId);
  if ((agent as { delisted?: unknown }).delisted) {
    throw new CliError(`${agent.name ?? tokenId} is delisted, so it is not called`, "delisted");
  }
  const endpoint = agent.mcp_server;
  if (!endpoint) {
    throw new CliError(`${agent.name ?? tokenId} declares no MCP server`, "no_endpoint");
  }
  return { agent, url: assertCallableEndpoint(endpoint) };
}

export interface McpToolsResult {
  agent: Awaited<ReturnType<typeof showAgent>>;
  endpoint: string;
  latencyMs: number;
  tools: McpTool[];
}

export async function listMcpTools(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  options: { timeoutMs?: number } = {},
): Promise<McpToolsResult> {
  const { agent, url } = await serverFor(config, chainId, tokenId);
  const started = Date.now();
  const session = await open(url, options.timeoutMs ?? 30_000);
  const answer = await post(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    session,
    options.timeoutMs ?? 30_000,
  );
  const result = answer.result as { tools?: unknown } | null;
  const tools = Array.isArray(result?.tools)
    ? result.tools.filter((t): t is McpTool => Boolean(t) && typeof t === "object" && typeof (t as McpTool).name === "string")
    : [];
  return { agent, endpoint: url.toString(), latencyMs: Date.now() - started, tools };
}

export interface McpCallResult {
  agent: Awaited<ReturnType<typeof showAgent>>;
  endpoint: string;
  latencyMs: number;
  tool: string;
  text: string;
  result: unknown;
}

export async function callMcpTool(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  tool: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<McpCallResult> {
  const { agent, url } = await serverFor(config, chainId, tokenId);
  const started = Date.now();
  const session = await open(url, options.timeoutMs ?? 30_000);
  const answer = await post(
    url,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    },
    session,
    options.timeoutMs ?? 30_000,
  );
  const result = answer.result;
  const text = textFromResult(result);
  if ((result as { isError?: unknown } | null)?.isError === true) {
    throw new CliError(`the MCP tool ${tool} returned an error: ${text || "unknown"}`, "call_failed");
  }
  return { agent, endpoint: url.toString(), latencyMs: Date.now() - started, tool, text, result };
}
