import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES, targetChainId } from "@/lib/types";
import {
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_SUPPORTED_VERSIONS,
  MCP_TOOLS,
  type McpToolName,
} from "@/lib/mcp-tools";

export const dynamic = "force-dynamic";
// a delivery lets the agent call run for 20s, so this handler needs room past the default
export const maxDuration = 60;

// A streamable HTTP client accepts application/json and may also ask for
// text/event-stream; this server always answers with one JSON message. CORS is
// open because the in-browser WebMCP surface calls the same endpoint.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const API_TIMEOUT_MS = 30000;
const DELIVER_TIMEOUT_MS = 60000;

type RpcId = string | number | null;

interface ToolText {
  content: { type: "text"; text: string }[];
  isError: boolean;
}

// The MCP server runs in the same app as the API it exposes, so a tool is a call
// to the public route. That keeps one implementation of each rule and matches a
// server that could be deployed away from the routes.
function apiBase(req: NextRequest): string {
  try {
    const origin = new URL(req.url).origin;
    if (origin && origin !== "null") return origin;
  } catch {
    // fall through to the configured base
  }
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function apiJson(
  req: NextRequest,
  path: string,
  init: { method: string; body?: unknown },
  timeoutMs = API_TIMEOUT_MS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const hasBody = init.body !== undefined;
    const res = await fetch(new URL(path, apiBase(req)), {
      method: init.method,
      headers: hasBody
        ? { accept: "application/json", "content-type": "application/json" }
        : { accept: "application/json" },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { error: `non-JSON response (HTTP ${res.status})` };
    }
    return {
      status: res.status,
      body: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed },
    };
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function networkChainId(requirements: Record<string, unknown>): number | undefined {
  const network = asString(requirements.network);
  if (!network) return undefined;
  const parsed = Number.parseInt(network.split(":")[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extraValue(requirements: Record<string, unknown>, key: string): unknown {
  const extra = isRecord(requirements.extra) ? requirements.extra : {};
  return extra[key] ?? null;
}

function apiError(body: Record<string, unknown>, status: number): string {
  return asString(body.error) ?? `HTTP ${status}`;
}

function toolText(text: string, isError = false): ToolText {
  return { content: [{ type: "text", text }], isError };
}

function toolJson(value: unknown): ToolText {
  return toolText(JSON.stringify(value, null, 2));
}

function rpcId(value: unknown): RpcId {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function rpcResult(id: RpcId, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { headers: JSON_HEADERS });
}

function rpcError(
  id: RpcId,
  code: number,
  message: string,
  httpStatus = 200,
): NextResponse {
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
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  };
}

async function listCategories(req: NextRequest): Promise<ToolText> {
  const { status, body } = await apiJson(req, "/api/agents?limit=1", { method: "GET" });
  if (status !== 200) return toolText(apiError(body, status), true);
  const counts = isRecord(body.counts) ? body.counts : {};
  return toolJson({
    chainId: asNumber(body.chainId) ?? targetChainId(),
    categories: CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
      short: c.short,
      description: c.description,
      blurb: c.blurb,
      agentCount: asNumber(counts[c.key]) ?? 0,
    })),
    note: "Pass a key as the category filter to list_agents. Agents that fit none of the four appear under category general.",
  });
}

async function listAgents(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const params = new URLSearchParams();
  const category = asString(args.category);
  if (category) params.set("category", category);
  const q = asString(args.q);
  if (q) params.set("q", q);
  const sort = asString(args.sort);
  if (sort) params.set("sort", sort);
  const page = asNumber(args.page);
  if (page !== undefined) params.set("page", String(page));
  const limit = asNumber(args.limit);
  if (limit !== undefined) params.set("limit", String(limit));

  const { status, body } = await apiJson(req, `/api/agents?${params.toString()}`, {
    method: "GET",
  });
  if (status !== 200) return toolText(apiError(body, status), true);
  return toolJson(body);
}

async function getAgent(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const tokenId = asString(args.tokenId);
  if (!tokenId) return toolText("tokenId is required.", true);
  const chainId = asNumber(args.chainId) ?? targetChainId();
  const { status, body } = await apiJson(
    req,
    `/api/agents/${chainId}/${encodeURIComponent(tokenId)}`,
    { method: "GET" },
  );
  if (status !== 200) return toolText(apiError(body, status), true);
  return toolJson(body);
}

async function listHires(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const wallet = asString(args.wallet);
  if (!wallet) return toolText("wallet is required.", true);
  const { status, body } = await apiJson(
    req,
    `/api/hires/by-wallet?wallet=${encodeURIComponent(wallet)}`,
    { method: "GET" },
  );
  if (status !== 200) return toolText(apiError(body, status), true);
  return toolJson(body);
}

async function getHireRequirements(
  req: NextRequest,
  args: Record<string, unknown>,
): Promise<ToolText> {
  const tokenId = asString(args.tokenId);
  if (!tokenId) return toolText("tokenId is required.", true);

  const payload: Record<string, unknown> = { tokenId };
  const chainId = asNumber(args.chainId);
  if (chainId !== undefined) payload.chainId = chainId;
  const amountUsd = asNumber(args.amountUsd);
  if (amountUsd !== undefined) payload.amountUsd = amountUsd;
  const client = asString(args.client);
  if (client) payload.client = client;

  const { status, body } = await apiJson(req, "/api/x402/requirements", {
    method: "POST",
    body: payload,
  });
  if (status !== 200) return toolText(apiError(body, status), true);

  const data = isRecord(body.data) ? body.data : {};
  const preview = isRecord(data.preview) ? data.preview : {};
  const requirements = isRecord(data.paymentRequirements) ? data.paymentRequirements : {};
  return toolJson({
    paymentId: preview.paymentId ?? null,
    paymentRequirements: requirements,
    agent: data.agent ?? null,
    sign: {
      schema: "eip3009 transferWithAuthorization",
      domain: {
        name: extraValue(requirements, "name"),
        version: extraValue(requirements, "version"),
        chainId: networkChainId(requirements) ?? null,
        verifyingContract: requirements.asset ?? null,
      },
      fields: {
        from: client ?? "the buyer wallet that signs",
        to: requirements.payTo ?? null,
        value: requirements.amount ?? null,
        validAfter: "unix seconds, for example now minus 60",
        validBefore: "unix seconds, for example now plus maxTimeoutSeconds",
        nonce: "random 32 bytes as 0x hex",
      },
    },
    next: "Sign locally with the buyer wallet, then call start_hire with paymentRequirements and the signed paymentPayload.",
  });
}

async function startHire(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const tokenId = asString(args.tokenId);
  const requirements = isRecord(args.paymentRequirements) ? args.paymentRequirements : null;
  const payment = isRecord(args.paymentPayload) ? args.paymentPayload : null;

  if (!tokenId) return toolText("tokenId is required.", true);
  if (!requirements) {
    return toolText(
      "paymentRequirements is required and must be the object returned by get_hire_requirements.",
      true,
    );
  }
  if (!payment) {
    return toolText(
      "paymentPayload is required and must be signed by the buyer's own wallet. The marketplace does not sign and does not accept a private key.",
      true,
    );
  }

  const chainId = asNumber(args.chainId) ?? networkChainId(requirements) ?? targetChainId();

  // the settle route files the task and the job under the agent identity, so read
  // the name from the registry rather than trusting a caller-supplied label
  const detail = await apiJson(
    req,
    `/api/agents/${chainId}/${encodeURIComponent(tokenId)}`,
    { method: "GET" },
  );
  if (detail.status !== 200) {
    return toolText(`Cannot start a hire: ${apiError(detail.body, detail.status)}`, true);
  }
  const agentData = isRecord(detail.body.data) ? detail.body.data : {};
  const name = asString(agentData.name) ?? "Agent";

  const settleBody: Record<string, unknown> = {
    paymentRequirements: requirements,
    paymentPayload: payment,
    agent: { chainId, tokenId, name },
  };
  const paymentId = asString(args.paymentId);
  if (paymentId) settleBody.paymentId = paymentId;
  const amountUsd = asNumber(args.amountUsd);
  if (amountUsd !== undefined) settleBody.amountUsd = amountUsd;

  const { status, body } = await apiJson(req, "/api/x402/settle", {
    method: "POST",
    body: settleBody,
  });
  if (!(status === 200 && body.success === true)) {
    return toolText(`Hire not settled (HTTP ${status}): ${apiError(body, status)}`, true);
  }

  return toolJson({
    settled: true,
    paymentId: body.paymentId ?? null,
    txHash: body.txHash ?? null,
    taskId: body.taskId ?? null,
    jobId: body.jobId ?? null,
    jobStatus: body.jobStatus ?? null,
    details: body.details ?? null,
    next: "The session is settled and a hire task is open. Call deliver_task with paymentId to run it, then get_task to read the deliverable.",
  });
}

async function deliverTask(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const paymentId = asString(args.paymentId);
  if (!paymentId) {
    return toolText("paymentId is required. Settle a session with start_hire first.", true);
  }

  const deliverBody: Record<string, unknown> = { paymentId };
  const tool = asString(args.tool);
  if (tool) deliverBody.tool = tool;
  if (isRecord(args.args)) deliverBody.args = args.args;
  const task = asString(args.task);
  if (task) deliverBody.task = task;
  if (isRecord(args.input)) deliverBody.input = args.input;

  const { status, body } = await apiJson(
    req,
    "/api/x402/deliver",
    { method: "POST", body: deliverBody },
    DELIVER_TIMEOUT_MS,
  );
  if (!(status === 200 && body.success === true)) {
    return toolText(`Delivery did not complete (HTTP ${status}): ${apiError(body, status)}`, true);
  }

  const data = isRecord(body.data) ? body.data : {};
  return toolJson({ ...data, next: "Read the stored task and deliverable with get_task." });
}

async function getTaskTool(req: NextRequest, args: Record<string, unknown>): Promise<ToolText> {
  const taskId = asString(args.taskId);
  if (!taskId) return toolText("taskId is required.", true);
  const { status, body } = await apiJson(
    req,
    `/api/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
  );
  if (status !== 200) return toolText(apiError(body, status), true);
  return toolJson(body);
}

function runTool(
  req: NextRequest,
  name: McpToolName,
  args: Record<string, unknown>,
): Promise<ToolText> {
  switch (name) {
    case "list_categories":
      return listCategories(req);
    case "list_agents":
      return listAgents(req, args);
    case "get_agent":
      return getAgent(req, args);
    case "get_hire_requirements":
      return getHireRequirements(req, args);
    case "start_hire":
      return startHire(req, args);
    case "deliver_task":
      return deliverTask(req, args);
    case "get_task":
      return getTaskTool(req, args);
    case "list_hires":
      return listHires(req, args);
    default:
      return Promise.resolve(toolText(`Unknown tool: ${name}`, true));
  }
}

async function toolsCall(
  req: NextRequest,
  id: RpcId,
  params: unknown,
): Promise<NextResponse> {
  if (!isRecord(params) || !asString(params.name)) {
    return rpcError(id, -32602, "Invalid params: a tool name is required");
  }
  const name = params.name as string;
  const args = isRecord(params.arguments) ? params.arguments : {};
  const known = MCP_TOOLS.some((t) => t.name === name);
  if (!known) return rpcError(id, -32602, `Unknown tool: ${name}`);
  try {
    return rpcResult(id, await runTool(req, name, args));
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
      return rpcResult(id, { tools: MCP_TOOLS });
    case "tools/call":
      return toolsCall(req, id, message.params);
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

// This server is stateless: it has no server-initiated SSE stream and holds no
// session, so GET and DELETE are refused with an Allow header.
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
