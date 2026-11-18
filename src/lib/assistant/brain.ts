// the Souk Assistant: a model that answers buyers and sellers by calling Agent Souk's own MCP
// tools. it reads freely and prepares actions as links the user confirms in their own wallet; it
// has no tool that signs, pays or changes anything, so a bad answer can never move money

import { MCP_TOOLS } from "../mcp-tools";
import { LOCAL_TOOLS, LOCAL_TOOL_NAMES, callLocalTool } from "./local-tools";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelEndpoint {
  base: string;
  key: string;
  model: string;
}

export interface AssistantAction {
  label: string;
  url: string;
}

export interface AssistantReply {
  text: string;
  model: string;
  toolCalls: string[];
  // each prepared action, shown under the answer as a button rather than a pasted link
  actions: AssistantAction[];
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
  "Never mention your tools, their names, queries or calls, or how you work inside; talk only about what the user sees and does.",
  "Answer in plain words, briefly, in a few short lines, with no tables. Say pay per answer, pay on delivery and vault hire; never name protocols such as x402, EIP-3009 or ERC-8183 unless the user asks.",
  "Use the tools to find agents, read their details, prices and records, and read a user's hires.",
  "For the user's own agents, earnings or hires use my_listings, my_earnings and my_hires; they read only the user's linked wallet. If the user pastes an address instead, use lookup_address and call the result that address's agents, not theirs. For which stock pools are earning, use fluxlp_pools and give the real numbers.",
  "Agents built by Agent Souk come first when they fit, and these facts about them are exact:",
  "Souk Health Guard (token 404603) watches a Venus loan's health factor and repays debt to protect it, inside limits the user sets; it never sells collateral; it is hired per answer or on delivery, not by vault.",
  "Souk Grid Planner (391004) plans a grid ladder and trades it inside a vault hire.",
  "Souk Drift Guard (368655) and Souk Band Keeper (391002) rebalance inside vault hires.",
  "Souk Yield Lens (391003) keeps stable money earning inside a vault hire.",
  "Flux LP (406220) manages liquidity in tokenized stock pools on PancakeSwap and Uniswap; its pools and their results are at fluxlp.agentsouk.xyz.",
  "Mention one or two outside agents only when they clearly fit better.",
  "State only the ways to pay that the tools show for an agent. Give prices with the unit the tool gives: U is the payment token, not BNB. If a fact is not in the tool results or above, say you do not know.",
  "You cannot sign, pay, hire or change anything. When the user wants to act, call prepare_action with a short button label such as Hire Souk Band Keeper; the link appears as a button under your answer, so do not write the link yourself. They confirm in their own wallet. To list or sell an agent, prepare the sell action at once; it needs no token id.",
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
        label: { type: "string", description: "the button text, a few words, such as Hire Souk Band Keeper" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
};

const DEFAULT_LABEL: Record<string, string> = {
  hire: "Open the hire page",
  compare: "Compare agents",
  open_agent: "Open the agent",
  my_hires: "Open My hires",
  sell: "List an agent",
};

// the model's label, kept short and plain, or a fixed one for the action
export function actionLabel(action: string | undefined, label: unknown): string {
  const given = typeof label === "string" ? label.replace(/[^\p{L}\p{N} .,'&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return given || DEFAULT_LABEL[action ?? ""] || "Open Agent Souk";
}

// the answer without anything already shown as a button: a bracketed label, or the link itself
export function withoutButtons(text: string, actions: AssistantAction[]): string {
  let out = text;
  for (const a of actions) {
    out = out.split(`[${a.label}](${a.url})`).join("").split(`[${a.label}]`).join("").split(a.url).join("");
  }
  return out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

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
  return [...read, ...LOCAL_TOOLS, PREPARE_TOOL];
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
// one model reply, trying each endpoint in turn. a rate limit or an outage moves straight to the next
// model rather than waiting, and the conversation so far, lookups included, carries over. only when
// every model is rate limited does it wait once, and never past the time left
async function completeAny(
  endpoints: ModelEndpoint[],
  messages: ChatMsg[],
  fetchImpl: typeof fetch,
  opts: { waitMs: number; deadline: number; tools: boolean },
): Promise<{ msg: ModelMessage; model: string }> {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let limited = false;
    for (const [i, endpoint] of endpoints.entries()) {
      try {
        // a backup model gets the lookups as plain text: some refuse tool calls another model made
        const sent = i === 0 ? messages : flattenLookups(messages);
        return { msg: await complete(endpoint, sent, fetchImpl, opts.tools), model: endpoint.model };
      } catch (e) {
        errors.push(`${endpoint.model}: ${(e as Error).message}`);
        if (e instanceof ModelError && (e.status === 429 || e.status === 503)) limited = true;
      }
    }
    const wait = Math.min(opts.waitMs, opts.deadline - Date.now() - 8_000);
    if (!limited || wait <= 0) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`no model answered (${errors.join("; ") || "none configured"})`);
}

// the conversation with each lookup written out as text, for a model that did not make the calls
export function flattenLookups(messages: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "user", content: `Lookup result: ${m.content}` });
    } else if (m.role === "assistant" && m.tool_calls?.length) {
      const asked = m.tool_calls.map((c) => `${c.function.name} ${c.function.arguments || "{}"}`).join("; ");
      out.push({ role: "assistant", content: [m.content, `I looked up: ${asked}`].filter(Boolean).join("\n") });
    } else {
      out.push(m);
    }
  }
  return out;
}

type ModelMessage = { content?: string | null; tool_calls?: ToolCall[]; [extra: string]: unknown };

async function complete(endpoint: ModelEndpoint, messages: ChatMsg[], fetchImpl: typeof fetch, tools = true): Promise<ModelMessage> {
  const url = chatUrl(endpoint.base);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${endpoint.key}` },
    // with tools off the model has to answer from what it already looked up
    body: JSON.stringify({ model: endpoint.model, messages, tools: assistantTools(), tool_choice: tools ? "auto" : "none", temperature: 0.2 }),
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
// what the model is told about the user's wallet, worded so its reply can repeat it to the user as is
export function walletNote(wallet: string | null, surface: "web" | "telegram"): string {
  if (wallet) return ` The user's linked wallet is ${wallet}; the my_ tools read it.`;
  const how = surface === "telegram" ? "send /link here" : "connect your wallet with the Connect button at the top of the page";
  return ` No wallet is linked yet. When the user asks about their own agents, earnings or hires, reply in one short line: "Please ${how}, then ask again and I will check." Do not list steps.`;
}

export async function askAssistant(input: {
  history: AssistantMessage[];
  endpoints: ModelEndpoint[];
  mcpUrl: string;
  wallet?: string | null;
  surface?: "web" | "telegram";
  fetchImpl?: typeof fetch;
  // how long to wait before one retry after a rate limit; tests pass 0
  retryWaitMs?: number;
  // how long the assistant may spend looking things up before it must answer
  budgetMs?: number;
}): Promise<AssistantReply> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const system = SYSTEM_PROMPT + walletNote(input.wallet ?? null, input.surface ?? "web");
  const endpoints = input.endpoints.filter((e) => e.key && e.model);
  if (endpoints.length === 0) throw new Error("no model answered (none configured)");
  // the routes stop a request at 120 seconds; past the budget the assistant answers from what it has
  const deadline = Date.now() + (input.budgetMs ?? 40_000);
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    ...input.history.slice(-12).map((m): ChatMsg => (m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content })),
  ];
  const toolCalls: string[] = [];
  const actions: AssistantAction[] = [];
  for (let round = 0; ; round++) {
    const lookups = round < MAX_TOOL_ROUNDS && Date.now() < deadline;
    const { msg, model } = await completeAny(endpoints, messages, fetchImpl, { waitMs: input.retryWaitMs ?? 20_000, deadline: deadline + 30_000, tools: lookups });
    if (!msg.tool_calls?.length || !lookups) {
      return { text: withoutButtons((msg.content ?? "").trim(), actions) || "I could not find an answer to that.", model, toolCalls, actions };
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
      if (call.function.name === "prepare_action") {
        const url = prepareLink(args as { action?: string; chainId?: number; tokenId?: string });
        if (!actions.some((a) => a.url === url)) actions.push({ label: actionLabel(args.action as string | undefined, args.label), url });
      }
      const result =
        call.function.name === "prepare_action"
          ? JSON.stringify({ link: prepareLink(args as { action?: string; chainId?: number; tokenId?: string }), note: "Shown to the user as a button under your answer; they confirm in their own wallet on this page." })
          : LOCAL_TOOL_NAMES.has(call.function.name)
            ? await callLocalTool(call.function.name, input.wallet, fetchImpl, args)
            : await callMcpTool(input.mcpUrl, call.function.name, args, fetchImpl);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
}
