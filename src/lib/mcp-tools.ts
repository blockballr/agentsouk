// The MCP tool surface of the marketplace, kept as data so the same names and
// schemas can back the Skill and the in-browser WebMCP surface. Each tool calls
// one public API route; none of them can move a buyer's funds.

import { CATEGORY_KEYS } from "@/lib/types";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_SUPPORTED_VERSIONS = [
  MCP_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05",
];

export const MCP_SERVER_INFO = {
  name: "agent-souk-marketplace",
  version: "0.1.0",
};

// Repeated to a caller at initialize, so the non-custodial rule and the order of
// operations are not something an agent has to infer from individual tools.
export const MCP_INSTRUCTIONS = [
  "Agent Souk is a marketplace of ERC-8004 agents on BSC. Every hire is non-custodial: the buyer signs an EIP-3009 authorization with their own funded wallet and the marketplace only verifies and relays it. It never holds buyer funds and never accepts a private key.",
  "Browse with list_categories, list_agents and get_agent.",
  "Hire with get_hire_requirements, then sign the returned paymentRequirements locally, then start_hire with the signed paymentPayload. That settles the session and opens a hire task.",
  "Run the hire with deliver_task, and read the deliverable with get_task. For an MCP agent call deliver_task with only paymentId first to list its tools, then again with tool and args. For an A2A agent pass task, and pass input when the agent requires a structured input.",
  "A task cannot run before its session is settled. The signing wallet must hold enough of the settlement token named in the requirements.",
].join("\n");

export const CATEGORY_VALUES = ["all", ...CATEGORY_KEYS, "general"];

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  annotations?: {
    readOnlyHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_categories",
    title: "List agent categories",
    description:
      "List the four marketplace categories (rebalancing, grid-trading, yield, health-factor) with their labels and the live number of listed agents in each. Use the key to filter list_agents. Agents that fit none of the four are listed under category general.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "list_agents",
    title: "List agents",
    description:
      "List marketplace agents, optionally filtered by category and text, with their verification status, score and callable endpoints. Returns up to limit agents per page (default 24, maximum 60) plus category counts.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: CATEGORY_VALUES,
          description: "Category key to filter by. Defaults to all.",
        },
        q: {
          type: "string",
          description: "Free text search over name and description.",
        },
        sort: {
          type: "string",
          enum: ["score", "newest", "feedback", "health", "reachability"],
          description: "Ranking. Defaults to score.",
        },
        page: {
          type: "integer",
          minimum: 1,
          description: "1-based page number. Defaults to 1.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 60,
          description: "Agents per page. Defaults to 24.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_agent",
    title: "Get one agent",
    description:
      "Get one agent's full registry detail, including its verification status (delivered, gated, stale or unreachable), score, owner, agent wallet, and its MCP or A2A endpoint if it has one. Call this before hiring to learn how the agent is invoked.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: {
          type: "string",
          description: "The ERC-8004 token id of the agent.",
        },
        chainId: {
          type: "integer",
          description: "Chain id. Defaults to the chain this deployment serves.",
        },
      },
      required: ["tokenId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_hire_requirements",
    title: "Prepare a hire",
    description:
      "Prepare a paid session with one agent. Returns the x402 paymentRequirements (asset, amount, payTo and EIP-712 domain) and a paymentId. The caller must already have a wallet funded with that settlement token. Sign the requirements as an EIP-3009 transferWithAuthorization with that wallet, then call start_hire with the signed payload. The marketplace never signs and never holds the funds.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: {
          type: "string",
          description: "The ERC-8004 token id of the agent to hire.",
        },
        chainId: {
          type: "integer",
          description: "Chain id. Defaults to the chain this deployment serves.",
        },
        amountUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Session price in USD. Defaults to the marketplace price.",
        },
        client: {
          type: "string",
          description: "The buyer wallet address that will sign the authorization.",
        },
      },
      required: ["tokenId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "start_hire",
    title: "Start a hire",
    description:
      "Start a hire by submitting an already signed EIP-3009 transferWithAuthorization, exactly as the browser does. Supply the paymentRequirements returned by get_hire_requirements and a paymentPayload signed by the buyer's own wallet. The marketplace verifies and relays the authorization; it cannot move buyer funds and does not accept a private key. On success a settled session and a hire task are opened. Call deliver_task next to run the task.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: {
          type: "string",
          description: "The ERC-8004 token id of the agent being hired.",
        },
        paymentRequirements: {
          type: "object",
          description:
            "The exact paymentRequirements object returned by get_hire_requirements.",
        },
        paymentPayload: {
          type: "object",
          description:
            "The buyer-signed EIP-3009 payload. payload.authorization carries from, to, value, validAfter, validBefore, nonce and signature, plus resource and accepted.",
        },
        paymentId: {
          type: "string",
          description: "The paymentId returned by get_hire_requirements, echoed into the receipt.",
        },
        chainId: {
          type: "integer",
          description: "Chain id. Defaults to the network in paymentRequirements.",
        },
        amountUsd: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Session price in USD, matching the signed value.",
        },
      },
      required: ["tokenId", "paymentRequirements", "paymentPayload"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "deliver_task",
    title: "Run a settled hire",
    description:
      "Run a hire whose session is already settled and return the agent's deliverable. For an MCP agent, call with only paymentId first to list the agent's tools, then call again with tool and args. For an A2A agent, pass task text. Pass input when the agent requires a structured input object, which is what agents reading a data part expect. A task cannot run before its session is settled.",
    inputSchema: {
      type: "object",
      properties: {
        paymentId: {
          type: "string",
          description: "The settled payment id from start_hire.",
        },
        tool: {
          type: "string",
          description: "For an MCP agent, the tool name to call.",
        },
        args: {
          type: "object",
          description: "For an MCP agent, the arguments for that tool.",
        },
        task: {
          type: "string",
          description: "For an A2A agent, the task text to send.",
        },
        input: {
          type: "object",
          description:
            "Structured input for agents that require it. Must be a plain JSON object.",
        },
      },
      required: ["paymentId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "get_task",
    title: "Read a task and its deliverable",
    description:
      "Read one hire task by id: its status, protocol, error and the deliverable text in result. Use it after deliver_task, to poll a running task, or to check whether a retry is allowed.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task id returned by start_hire or deliver_task.",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "list_hires",
    title: "List a wallet's hires",
    description:
      "List the settled sessions for one wallet address, newest first, with the agent, category, spend cap, expiry and transaction hash. Only sessions that were actually settled and activated are returned.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: {
          type: "string",
          description: "The buyer wallet address, 0x followed by 40 hex characters.",
        },
      },
      required: ["wallet"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
