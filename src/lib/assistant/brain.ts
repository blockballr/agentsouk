// the Souk Assistant: a model that answers buyers and sellers by calling Agent Souk's own MCP
// tools. it reads freely and prepares actions as links the user confirms in their own wallet; it
// has no tool that signs, pays or changes anything, so a bad answer can never move money

import { MCP_TOOLS } from "../mcp-tools";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelEndpoint {
  base: string;
  key: string;
  model: string;
}

export interface AssistantReply {
  text: string;
  model: string;
  toolCalls: string[];
}

// every tool here only reads; start_hire, deliver_task and vault_track write, so they are left out
export const READ_TOOLS = new Set([
  "get_runbook",
  "list_categories",
  "list_agents",
  "get_agent",
  "get_hire_requirements",
  "get_task",
  "list_hires",
  "vault_describe",
  "vault_venues",
  "vault_position",
  "vault_receipts",
]);

const APP = "https://app.agentsouk.xyz";
const MAX_TOOL_ROUNDS = 5;
const MAX_TOOL_TEXT = 2500;

export const SYSTEM_PROMPT = [
  "You are the Souk Assistant for Agent Souk, a marketplace on BNB Chain where AI agents act on chain.",
  "Buyers pay an agent in one of three ways: pay per answer, pay on delivery (an escrow job), or a vault hire where their money stays in a contract and the agent trades only inside limits they sign.",
  "Answer in plain words, briefly, in a few short lines, with no tables. Say pay per answer, pay on delivery and vault hire; never name protocols such as x402, EIP-3009 or ERC-8183 unless the user asks.",
  "Use the tools to find agents, read their details, prices and records, and read a user's hires.",
  "Agents built by Agent Souk come first when they fit, and these facts about them are exact:",
  "Souk Health Guard (token 404603) watches a Venus loan's health factor and repays debt to protect it, inside limits the user sets; it never sells collateral; it is hired per answer or on delivery, not by vault.",
  "Souk Grid Planner (391004) plans a grid ladder and trades it inside a vault hire.",
  "Souk Drift Guard (368655) and Souk Band Keeper (391002) rebalance inside vault hires.",
  "Souk Yield Lens (391003) keeps stable money earning inside a vault hire.",
  "Flux LP (406220) manages liquidity in tokenized stock pools on PancakeSwap and Uniswap; its pools and their results are at fluxlp.agentsouk.xyz.",
  "Mention one or two outside agents only when they clearly fit better.",
  "State only the ways to pay that the tools show for an agent. Give prices with the unit the tool gives: U is the payment token, not BNB. If a fact is not in the tool results or above, say you do not know.",
  "You cannot sign, pay, hire or change anything. When the user wants to act, call prepare_action and give them the link it returns; they confirm in their own wallet.",
  "Never invent agents, prices, numbers or transactions: say what the tools returned, or that you could not find it.",
  "Never give personal investment advice. You may describe what an agent does and what its record shows.",
].join(" ");

const PREPARE_TOOL = {
  type: "function" as const,
  function: {
    name: "prepare_action",
    description:
      "Prepare an action the user will confirm in their own wallet, and get the link to send them. Use it to hire an agent, compare an agent with similar ones, or open a page.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["hire", "compare", "open_agent", "my_hires", "sell"] },
        chainId: { type: "number", description: "56 for BNB Chain mainnet" },
        tokenId: { type: "string", description: "the agent's token id, for hire, compare and open_agent" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
};

export function prepareLink(args: { action?: string; chainId?: number; tokenId?: string }): string {
  const chain = args.chainId ?? 56;
  const token = String(args.tokenId ?? "").replace(/[^0-9]/g, "");
  switch (args.action) {
    case "hire":
    case "open_agent":
      return token ? `${APP}/agents/${chain}/${token}` : `${APP}/agents`;
    case "compare":
      return token ? `${APP}/compare?agent=${chain}/${token}` : `${APP}/compare`;
    case "my_hires":
      return `${APP}/ongoing`;
    case "sell":
      return `${APP}/build`;
    default:
      return `${APP}/agents`;
  }
}

export function assistantTools() {
  const read = MCP_TOOLS.filter((t) => READ_TOOLS.has(t.name)).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description.slice(0, 280), parameters: t.inputSchema },
  }));
  return [...read, PREPARE_TOOL];
}

type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// a configured base may be the bare host or already end in the provider's openai-style path
export function chatUrl(base: string): string {
  const b = base.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/(openai|v1|openai\/v1)$/.test(b)) return b + "/chat/completions";
  return b + (b.includes("googleapis.com") ? "/v1beta/openai/chat/completions" : "/openai/v1/chat/completions");
}

class ModelError extends Error {
  constructor(readonly status: number) {
    super(`model ${status}`);
  }
}

// a free tier answers 429 when its minute is used up; one wait and retry usually clears it
async function completeWithRetry(endpoint: ModelEndpoint, messages: ChatMsg[], fetchImpl: typeof fetch, waitMs: number) {
  try {
    return await complete(endpoint, messages, fetchImpl);
  } catch (e) {
    if (!(e instanceof ModelError) || e.status !== 429 || waitMs <= 0) throw e;
    await new Promise((r) => setTimeout(r, waitMs));
    return complete(endpoint, messages, fetchImpl);
  }
}

async function complete(endpoint: ModelEndpoint, messages: ChatMsg[], fetchImpl: typeof fetch) {
  const url = chatUrl(endpoint.base);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify({ model: endpoint.model, messages, tools: assistantTools(), tool_choice: "auto", temperature: 0.2 }),
  });
  if (!res.ok) throw new ModelError(res.status);
  const body = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown } }[] };
  const msg = body.choices?.[0]?.message;
  if (!msg) throw new Error("model returned no message");
  return msg;
}

// tool answers are compacted before the model reads them: long strings cut, long lists
// shortened, bulky fields dropped, so a request stays under a free tier's size limit
const DROP_KEYS = new Set(["inputModes", "outputModes", "examples", "tags", "raw_metadata", "supported_trust_models", "image_url", "contract_address"]);

export function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 160 ? value.slice(0, 157) + "..." : value;
  if (Array.isArray(value)) return value.slice(0, depth === 0 ? 10 : 6).map((v) => compact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!DROP_KEYS.has(k) && v !== null && v !== "") out[k] = compact(v, depth + 1);
    return out;
  }
  return value;
}

export async function callMcpTool(mcpUrl: string, name: string, args: unknown, fetchImpl: typeof fetch): Promise<string> {
  if (!READ_TOOLS.has(name)) return JSON.stringify({ error: `${name} is not available to the assistant` });
  const res = await fetchImpl(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args ?? {} } }),
  });
  const body = (await res.json().catch(() => null)) as { result?: { content?: { text?: string }[] }; error?: { message?: string } } | null;
  const raw = body?.result?.content?.map((c) => c.text ?? "").join("\n") ?? body?.error?.message ?? `tool answered ${res.status}`;
  let text = raw;
  try {
    text = JSON.stringify(compact(JSON.parse(raw)));
  } catch {
    // not json; the plain text is kept and cut below
  }
  return text.length > MAX_TOOL_TEXT ? text.slice(0, MAX_TOOL_TEXT) + "\n[cut for length]" : text;
}

// the conversation loop: the model asks for tools, we run them, until it answers in words.
// each endpoint is tried in order, so a free tier at its limit falls through to the next
export async function askAssistant(input: {
  history: AssistantMessage[];
  endpoints: ModelEndpoint[];
  mcpUrl: string;
  wallet?: string | null;
  fetchImpl?: typeof fetch;
  // how long to wait before one retry after a rate limit; tests pass 0
  retryWaitMs?: number;
}): Promise<AssistantReply> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const system = SYSTEM_PROMPT + (input.wallet ? ` The user's connected wallet is ${input.wallet}; use it when they ask about their own hires.` : " The user has not linked a wallet yet.");
  const errors: string[] = [];
  for (const endpoint of input.endpoints.filter((e) => e.key && e.model)) {
    const messages: ChatMsg[] = [
      { role: "system", content: system },
      ...input.history.slice(-12).map((m): ChatMsg => (m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content })),
    ];
    const toolCalls: string[] = [];
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const msg = await completeWithRetry(endpoint, messages, fetchImpl, input.retryWaitMs ?? 20_000);
        if (!msg.tool_calls?.length || round === MAX_TOOL_ROUNDS) {
          return { text: (msg.content ?? "").trim() || "I could not find an answer to that.", model: endpoint.model, toolCalls };
        }
        messages.push({ ...msg, role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          toolCalls.push(call.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            // a malformed argument string runs the tool with none, and the tool says what it needs
          }
          const result =
            call.function.name === "prepare_action"
              ? JSON.stringify({ link: prepareLink(args as { action?: string; chainId?: number; tokenId?: string }), note: "The user confirms in their own wallet on this page." })
              : await callMcpTool(input.mcpUrl, call.function.name, args, fetchImpl);
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      }
    } catch (e) {
      errors.push(`${endpoint.model}: ${(e as Error).message}`);
    }
  }
  throw new Error(`no model answered (${errors.join("; ") || "none configured"})`);
}
