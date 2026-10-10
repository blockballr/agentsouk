import "server-only";

import { privateEndpointReason } from "./endpoint";
import type { AgentCardSkill } from "./types";

// An agent that answers over MCP publishes its skills as the tools its server
// lists, so tools/list gives the same skill list an A2A card carries. Read for
// admission capture and for the agent page's own fallback. Self-contained on
// purpose: scanner imports this through agent-interface, and routing it through
// delivery would make scanner and delivery circular and drag the whole
// settlement stack into every browse test.

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface McpTool {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
}

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "agora-marketplace", version: "0.1.0" };

// one POST per step inside the caller's budget; a refused or timed out
// connection comes back as an error body so the caller can answer honestly
// instead of throwing out of a route
async function post(
  endpoint: string,
  req: RpcRequest,
  headers: Record<string, string>,
  deadline: number,
): Promise<{ status: number; body: RpcResponse; sessionId: string | null }> {
  const left = deadline - Date.now();
  if (left <= 0) {
    return { status: 0, body: { error: { code: -32000, message: "time budget spent" } }, sessionId: null };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), left);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(req),
      signal: ctl.signal,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    return {
      status: res.status,
      body: parseRpc(raw, contentType),
      sessionId: res.headers.get("mcp-session-id"),
    };
  } catch (e) {
    return {
      status: 0,
      body: { error: { code: -32000, message: `request failed: ${(e as Error).message}` } },
      sessionId: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// streamable HTTP servers may answer with SSE; the payload is in the last
// parseable data line
function parseRpc(raw: string, contentType: string): RpcResponse {
  if (contentType.includes("text/event-stream")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i -= 1) {
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

// the skill section renders a field's type and description, so the shapes JSON
// Schema allows (an array of types, a property that is not an object) are
// narrowed to what it can show rather than handed over to break a page view
function shownSchema(raw: unknown): NonNullable<AgentCardSkill["inputSchema"]> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const schema = raw as Record<string, unknown>;
  const properties: Record<string, { type?: string; description?: string }> = {};
  const source = schema.properties;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const meta = value as Record<string, unknown>;
      const entry: { type?: string; description?: string } = {};
      if (typeof meta.type === "string") entry.type = meta.type;
      else if (Array.isArray(meta.type)) {
        const joined = meta.type.filter((t): t is string => typeof t === "string").join(" | ");
        if (joined) entry.type = joined;
      }
      if (typeof meta.description === "string") entry.description = meta.description;
      properties[key] = entry;
    }
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === "string")
    : [];
  if (Object.keys(properties).length === 0 && required.length === 0) return undefined;
  const out: NonNullable<AgentCardSkill["inputSchema"]> = {
    type: typeof schema.type === "string" ? schema.type : "object",
  };
  if (Object.keys(properties).length > 0) out.properties = properties;
  if (required.length > 0) out.required = required;
  return out;
}

function skillFromTool(tool: McpTool): AgentCardSkill | null {
  if (typeof tool.name !== "string" || tool.name.trim() === "") return null;
  const skill: AgentCardSkill = { id: tool.name, name: tool.name };
  if (typeof tool.description === "string" && tool.description.trim() !== "") skill.description = tool.description;
  const schema = shownSchema(tool.inputSchema);
  if (schema) skill.inputSchema = schema;
  return skill;
}

// Read the skills an MCP agent publishes: initialize the session, then list the
// tools. A server that refuses initialize still gets one stateless tools/list,
// since the servers in the index do not all require a session.
export async function fetchMcpSkills(endpoint: string, timeoutMs = 4000): Promise<AgentCardSkill[] | null> {
  if (privateEndpointReason(endpoint)) return null;
  const deadline = Date.now() + timeoutMs;

  const init = await post(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    },
    {},
    deadline,
  );
  let sessionId: string | null = null;
  if (!init.body.error && init.status >= 200 && init.status < 300) {
    sessionId = init.sessionId;
    if (sessionId) {
      await post(
        endpoint,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { "mcp-session-id": sessionId },
        deadline,
      );
    }
  }

  const listed = await post(
    endpoint,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    sessionId ? { "mcp-session-id": sessionId } : {},
    deadline,
  );
  if (listed.status !== 0 && (listed.status < 200 || listed.status >= 300)) return null;
  if (listed.body.error) return null;
  const tools = Array.isArray(listed.body.result?.tools) ? (listed.body.result?.tools as McpTool[]) : [];
  const skills = tools.map(skillFromTool).filter((s): s is AgentCardSkill => s !== null);
  return skills.length > 0 ? skills : null;
}
