import { NextRequest, NextResponse } from "next/server";
import { GRID_AGENT_DESCRIPTION, GRID_AGENT_NAME, GRID_AGENT_VERSION } from "@/lib/reference-grid";
import { decideGridAgentTaskLive } from "@/lib/reference-grid-live";
import { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS } from "@/lib/mcp-tools";
import { getPaymentDurable, sessionRevoked } from "@/lib/receipts-store";
import { authoriseRungFill } from "@/lib/grid-execute";

export const dynamic = "force-dynamic";

// The grid agent's MCP surface, added beside its A2A one so a caller can reach
// the same capability either way. It is stateless like the marketplace server:
// no session is issued, no server stream is opened, and every call is one JSON
// request and one JSON reply. The tool is a thin adapter over the same
// decideGridAgentTaskLive the A2A route answers with, so the arithmetic and the
// PancakeSwap pair mode live in one place for both surfaces.

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const SERVER_INFO = { name: "souk-grid-planner", version: GRID_AGENT_VERSION };

const INSTRUCTIONS = [
  `${GRID_AGENT_NAME} plans grids, and it can hand back a bounded fill for one rung. It never sends a transaction itself and never holds a key.`,
  "plan_grid takes lowerUsd, upperUsd, levels and orderSizeUsd for the rung spacing, the committed value and the gross, fee and net capture of a round trip.",
  "Or, instead of lowerUsd and upperUsd, send pair (WBNB/USDT) and widthPct: the range is centred on that PancakeSwap v3 pool's price on the marketplace's chain, and the answer names the pool and the block it read.",
  "feeBps is optional: the round trip cost in basis points, an integer from 0 to 10000; 0 by default, or the pool's own round trip fee in pair mode.",
  "fill_rung takes a settled hire's paymentId and one rung, and answers with amountIn and amountOutMinimum. The floor is the rung less the slippage you allow, never a live quote, so a moved market cannot fill worse than the plan showed. It refuses a rung larger than the cap that hire granted.",
  "fill_rung places nothing. Execute the figures yourself with your own wallet; the hire is what authorises the spend, and revoking that hire stops any further fill.",
  "The planning arithmetic is deterministic, so every figure is reproducible from the values sent or the block read.",
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
// The two tools are different in kind. plan_grid reads nothing and sends nothing.
// fill_rung also sends nothing, but it returns the figures for a real fill, so it is
// declared readOnlyHint: false and it needs a settled hire before it will answer.
const TOOLS: GridAgentMcpTool[] = [
  {
    name: "plan_grid",
    title: "Plan a grid trading ladder",
    description: GRID_AGENT_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        lowerUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Lower price of the range in USD, greater than zero; leave out when sending a pair.",
        },
        upperUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Upper price of the range in USD, strictly above lowerUsd; leave out when sending a pair.",
        },
        pair: {
          type: "string",
          description:
            "Instead of lowerUsd and upperUsd: a PancakeSwap pair priced in dollars, WBNB/USDT. Sent with them, the prices win and the pair is not read.",
        },
        widthPct: {
          type: "number",
          exclusiveMinimum: 0,
          exclusiveMaximum: 200,
          description: "With a pair: the range width in percent, centred on the pool price.",
        },
        feeTier: {
          type: "integer",
          enum: [100, 500, 2500, 10000],
          description: "With a pair: optional pool fee tier; the deepest pool when left out.",
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
            "Optional round trip fee in basis points, an integer from 0 to 10000. Defaults to 0, or with a pair to the pool's own round trip, two swaps at its fee tier.",
        },
      },
      // the range is two prices or a pair and a width, so only these are always required
      required: ["levels", "orderSizeUsd"],
      additionalProperties: false,
    },
    // open world: with a pair the answer depends on the pool's state at the block read
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    // NOT read-only. This one returns the numbers for a real fill, so a caller can go
    // execute it with its own wallet. It never sends a transaction itself and never holds
    // a key; what it does is refuse a fill that no settled hire authorises.
    name: "fill_rung",
    title: "Turn one rung into a bounded fill",
    description:
      "Compute the bounded fill for one rung of a ladder: the amount in, and the smallest amount out that will still be accepted. The floor comes from the rung price you send, never from a live quote, so a moved market cannot fill worse than the plan showed. Requires a settled hire: send paymentId from a hire of this agent, and the rung is refused if the order is larger than the cap that hire granted. This tool places nothing and signs nothing; it returns figures for the caller to execute, or a refusal with the reason.",
    inputSchema: {
      type: "object",
      properties: {
        paymentId: {
          type: "string",
          description: "The settled payment id of a hire of this agent. Without it there is no buyer and no cap, so the rung is refused.",
        },
        side: {
          type: "string",
          enum: ["buy", "sell"],
          description: "Which way the rung trades. A rung below spot buys the base, above it sells.",
        },
        rungUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "The rung price the plan published, in USD per unit of the base token. This is what the floor is measured against.",
        },
        orderSizeUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "What this rung is worth in USD. Refused if it exceeds the cap the hire granted.",
        },
        feeBps: {
          type: "integer",
          minimum: 0,
          maximum: 9999,
          description: "The pool's swap fee in basis points, one way. Charged once, inside amountIn.",
        },
        maxSlippageBps: {
          type: "integer",
          minimum: 0,
          maximum: 9999,
          description: "How far the market may move against this fill before it reverts. Widens the rung on purpose and can never narrow it.",
        },
        baseToken: {
          type: "string",
          description: "Base token address for the pair.",
        },
        quoteToken: {
          type: "string",
          description: "Quote token address for the pair.",
        },
      },
      required: ["paymentId", "side", "rungUsd", "orderSizeUsd", "feeBps", "maxSlippageBps", "baseToken", "quoteToken"],
      additionalProperties: false,
    },
    // not idempotent: a fill is a fresh figure for one moment, and asking twice for a
    // moving market gives two answers
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
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

// A non-finite number is NaN here, so a rung priced at NaN is refused by the arithmetic
// rather than passed to the router as an amount.
function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
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

// An empty argument object is a plain probe, which the planner answers with the
// capability reply; a partial object is answered with input-required.
// The artifact is carried both as a text content part and as structuredContent,
// so a streamable HTTP client that only reads content still gets the payload.
async function callTool(args: Record<string, unknown>): Promise<ToolText> {
  const reply = await decideGridAgentTaskLive("", args);
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

// The fill rung half. A refusal is an answer, not a transport failure, so it comes back
// isError: false with the reason in the text. That way a caller reads "no cap for this
// hire" rather than a connection error and knows to fix the hire rather than retry.
async function callFillRung(args: Record<string, unknown>): Promise<ToolText> {
  const paymentId = asString(args.paymentId) ?? "";
  const stored = paymentId ? await getPaymentDurable(paymentId) : undefined;
  if (!stored) {
    return textAnswer(
      { refused: true, reason: "no settled hire with that paymentId, so nothing authorises this fill" },
      `No settled hire for ${paymentId || "(none given)"}, so no fill is authorised. Settle a hire of this agent first and send its paymentId.`,
    );
  }
  // A hire the buyer revoked authorises nothing, which is what revoke is for.
  if (await sessionRevoked(paymentId)) {
    return textAnswer(
      { refused: true, reason: "this hire's session was revoked" },
      "This hire's session was revoked, so it authorises no fill.",
    );
  }

  const side = asString(args.side);
  if (side !== "buy" && side !== "sell") {
    return textAnswer({ refused: true, reason: "side must be buy or sell" }, "side must be buy or sell.");
  }

  const authorisation = {
    paymentId: stored.paymentId,
    client: stored.client,
    symbol: stored.symbol,
    spendCapUsd: stored.session?.spendCapUsd ?? 0,
  };

  const result = authoriseRungFill({
    authorisation,
    side,
    rungUsd: asNumber(args.rungUsd),
    orderSizeUsd: asNumber(args.orderSizeUsd),
    feeBps: asNumber(args.feeBps),
    maxSlippageBps: asNumber(args.maxSlippageBps),
    baseToken: asString(args.baseToken) ?? "",
    quoteToken: asString(args.quoteToken) ?? "",
  });

  if (!result.ok || !result.fill) {
    return textAnswer(
      { refused: true, reason: result.reason ?? "refused" },
      `No fill: ${result.reason ?? "refused"}.`,
    );
  }

  const f = result.fill;
  const artifact = {
    authorised: true,
    side: f.side,
    tokenIn: f.tokenIn,
    tokenOut: f.tokenOut,
    amountIn: f.amountIn,
    amountOutMinimum: f.amountOutMinimum,
    referenceUsd: f.referenceUsd,
    feeBps: f.feeBps,
    maxSlippageBps: f.maxSlippageBps,
    // the cap this rung was measured against, so the caller can see the headroom left
    spendCapUsd: authorisation.spendCapUsd,
    orderSizeUsd: asNumber(args.orderSizeUsd),
    // restates the authority rather than leaving the caller to assume it
    authorisedBy: { paymentId: stored.paymentId, client: stored.client, symbol: stored.symbol },
  };

  return {
    content: [
      {
        type: "text",
        text:
          `Rung ${f.referenceUsd} USD authorised for ${f.side}. ` +
          `In ${f.amountIn} of tokenIn, and the fill reverts below ${f.amountOutMinimum} of tokenOut. ` +
          `The floor is the rung less ${f.maxSlippageBps} bps of slippage, not a live quote. ` +
          `This tool has placed nothing: execute it yourself with your own wallet.`,
      },
      { type: "text", text: JSON.stringify(artifact, null, 2) },
    ],
    structuredContent: artifact,
    isError: false,
  };
}

function textAnswer(artifact: Record<string, unknown>, text: string): ToolText {
  return {
    content: [
      { type: "text", text },
      { type: "text", text: JSON.stringify(artifact, null, 2) },
    ],
    structuredContent: artifact,
    isError: false,
  };
}

async function toolsCall(id: RpcId, params: unknown): Promise<NextResponse> {
  if (!isRecord(params) || !asString(params.name)) {
    return rpcError(id, -32602, "Invalid params: a tool name is required");
  }
  const name = params.name as string;
  if (!TOOLS.some((t) => t.name === name)) {
    return rpcError(id, -32602, `Unknown tool: ${name}`);
  }
  const args = isRecord(params.arguments) ? params.arguments : {};
  try {
    const answer =
      name === "fill_rung" ? await callFillRung(args) : await callTool(args);
    return rpcResult(id, answer);
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
