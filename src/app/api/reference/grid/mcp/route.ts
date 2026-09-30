import { NextRequest, NextResponse } from "next/server";
import {
  GRID_AGENT_NAME,
  GRID_TOOL_DESCRIPTION,
  GRID_AGENT_VERSION,
  decideGridAgentTask,
} from "@/lib/reference-grid";
import { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS } from "@/lib/mcp-tools";

export const dynamic = "force-dynamic";

// The grid agent's MCP surface, added beside its A2A one so a caller can reach
// the same capability either way. It is stateless like the marketplace server:
// no session is issued, no server stream is opened, and every call is one JSON
// request and one JSON reply. The tool is a thin adapter over the same
// decideGridAgentTask the A2A route answers with, so the arithmetic lives in
// one place. It is the plain planner only: the PancakeSwap pair mode, which reads
// the chain, is offered over A2A.

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const SERVER_INFO = { name: "souk-grid-planner", version: GRID_AGENT_VERSION };

const INSTRUCTIONS = [
  `${GRID_AGENT_NAME} is a read-only grid planner. It never reads market prices and never sends a transaction.`,
  "Call plan_grid with lowerUsd, upperUsd, levels and orderSizeUsd to get the rung spacing, the committed value and the gross, fee and net capture of a round trip.",
  "feeBps is optional: the round trip cost in basis points, an integer from 0 to 10000, defaulting to 0.",
  "Every figure is deterministic arithmetic on the values you supply, so it is reproducible.",
].join("\n");

interface GridAgentMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  annotations: { readOnlyHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

// The one tool is exactly the capability the A2A surface advertises, so a
// tools/list answer names the real inputs rather than a decorative schema. The
// handler still answers a plain probe and asks for a partial input instead of
// refusing, because the tool names required fields but does not reject on them.
const TOOLS: GridAgentMcpTool[] = [
  {
    name: "plan_grid",
    title: "Plan a grid trading ladder",
    description: GRID_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        lowerUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Lower price of the range in USD, greater than zero.",
        },
        upperUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Upper price of the range in USD, strictly above lowerUsd.",
        },
        levels: {
          type: "integer",
          minimum: 2,
          maximum: 200,
          description: "Number of price rungs, an integer from 2 to 200.",
        },
        orderSizeUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Value placed at each rung in USD, greater than zero.",
        },
        feeBps: {
          type: "integer",
          minimum: 0,
          maximum: 10000,
          description:
            "Optional round trip fee in basis points, an integer from 0 to 10000. Defaults to 0.",
        },
      },
      required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

type RpcId = string | number | null;

interface ToolText {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function rpcId(value: unknown): RpcId {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function rpcResult(id: RpcId, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: JSON_HEADERS });
}

function rpcError(id: RpcId, code: number, message: string, httpStatus = 200): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: httpStatus, headers: JSON_HEADERS },
  );
}

function initializeResult(params: unknown): Record<string, unknown> {
  const requested = isRecord(params) ? asString(params.protocolVersion) : undefined;
  const protocolVersion =
    requested && MCP_SUPPORTED_VERSIONS.includes(requested)
      ? requested
      : MCP_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

// An empty argument object is a plain probe, which decideGridAgentTask answers
// with the capability reply; a partial object is answered with input-required.
// The artifact is carried both as a text content part and as structuredContent,
// so a streamable HTTP client that only reads content still gets the payload.
function callTool(args: Record<string, unknown>): ToolText {
  const reply = decideGridAgentTask("", args);
  return {
    content: [
      { type: "text", text: reply.text },
      { type: "text", text: JSON.stringify(reply.artifact, null, 2) },
    ],
    structuredContent: reply.artifact,
    // input-required is a real answer, not a transport failure, and is left
    // non-error so it reads the same way the A2A surface reports it.
    isError: false,
  };
}

function toolsCall(id: RpcId, params: unknown): NextResponse {
  if (!isRecord(params) || !asString(params.name)) {
    return rpcError(id, -32602, "Invalid params: a tool name is required");
  }
  const name = params.name as string;
  if (!TOOLS.some((t) => t.name === name)) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    return rpcResult(id, callTool(args));
  } catch (e) {
    return rpcError(id, -32603, `Tool ${name} failed: ${(e as Error).message}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text().catch(() => "");
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error: the request body is not valid JSON", 400);
  }
  if (!isRecord(message)) {
    return rpcError(null, -32600, "Invalid Request: a JSON-RPC object is required", 400);
  }
  if (message.jsonrpc !== "2.0" || !asString(message.method)) {
    return rpcError(
      rpcId(message.id),
      -32600,
      'Invalid Request: jsonrpc must be "2.0" and method must be a string',
      400,
    );
  }

  const method = message.method as string;
  const id = rpcId(message.id);

  // a notification has no id and gets no reply, which is what the MCP client
  // sends for notifications/initialized after initialize
  if (message.id === undefined || message.id === null) {
    return new NextResponse(null, { status: 202, headers: JSON_HEADERS });
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, initializeResult(message.params));
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call":
      return toolsCall(id, message.params);
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers":
        "content-type, accept, mcp-session-id, mcp-protocol-version, authorization",
    },
  });
}

// Stateless: there is no server-initiated stream and no session, so GET and
// DELETE are refused with an Allow header.
export function GET(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "This MCP server is stateless: send JSON-RPC with POST." },
    },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST, OPTIONS" } },
  );
}

export function DELETE(): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "This MCP server holds no session to delete." },
    },
    { status: 405, headers: { ...JSON_HEADERS, allow: "POST, OPTIONS" } },
  );
}
