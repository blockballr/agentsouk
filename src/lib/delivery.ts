import "server-only";

import { fetchAgentDetail } from "@/lib/scanner";
import { privateEndpointReason } from "@/lib/endpoint";
import { getPaymentDurable } from "./receipts-store";
import {
  ensureTaskForPayment,
  markTaskDelivered,
  markTaskFailed,
  markTaskRunning,
} from "./tasks";
import { getJobByPaymentAsync, submitJobAsync, type JobStatus } from "./jobs";

// the delivery half of hire: a settled receipt unlocks invoking the agent's own endpoint.
// Two JSON-RPC protocols exist: MCP (initialize, tools/list, tools/call) and A2A (agent card, message/send); agents that gate direct calls behind their own x402 payment are surfaced as gated, not faked.

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
  } catch (e) {
    // a refused or timed out connection must not throw out of the route: the
    // caller turns this into an honest failure instead of an empty 500
    return {
      status: 0,
      contentType: "",
      body: { error: { code: -32000, message: `request failed: ${(e as Error).message}` } },
      sessionId: null,
    };
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

// the verifier reads these sentences to record gated instead of dead, so the
// wording and the pattern live together
export const GATED_RE = /gates direct calls behind its own (x402|login|ERC-8183 job)/i;

// a seller that takes work only through an on-chain ERC-8183 job answers a direct task with a
// quote, or with the skills it will accept, rather than doing the work; it is alive, so gated
export function jobSellerReply(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const quoted =
    result.status === "quoted" ||
    typeof result.negotiation_hash === "string" ||
    (isRecord(result.response) && typeof result.response.accepted === "boolean" && "request_hash" in result);
  const parts = Array.isArray(result.parts) ? result.parts : [];
  const asksForSkill = parts.some(
    (p) =>
      isRecord(p) &&
      isRecord(p.data) &&
      Array.isArray(p.data.skills) &&
      p.data.skills.some((k) => typeof k === "string" && /^negotiate/i.test(k)),
  );
  if (!quoted && !asksForSkill) return null;
  return quoted
    ? "This agent gates direct calls behind its own ERC-8183 job: it answered with a price quote and starts work only once a job is funded on BNB Chain's contracts, which the marketplace does not place yet."
    : "This agent gates direct calls behind its own ERC-8183 job: it accepts only its negotiate and notify_funded skills and starts work once a job is funded on BNB Chain's contracts, which the marketplace does not place yet.";
}

// an endpoint behind its own login answered, so the agent is alive but cannot be
// called anonymously, which is how the marketplace calls; gated, not dead
export function loginGatedOutcome(protocol: "mcp" | "a2a", status: number): DeliverOutcome | null {
  if (status !== 401 && status !== 403) return null;
  return {
    protocol,
    ok: false,
    gated: true,
    error: `This agent gates direct calls behind its own login (HTTP ${status}), and the marketplace calls anonymously, so it cannot run tasks here.`,
  };
}

async function deliverMcp(
  endpoint: string,
  tool?: string,
  args?: Record<string, unknown>,
): Promise<DeliverOutcome> {
  const blocked = privateEndpointReason(endpoint);
  if (blocked) {
    return {
      protocol: "mcp",
      ok: false,
      error: `${blocked}. the agent's registry record points there, so the owner needs to publish a public endpoint.`,
    };
  }
  const init = await mcpCall(endpoint, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agora-marketplace", version: "0.1.0" },
  }, null);
  const initGated = loginGatedOutcome("mcp", init.status);
  if (initGated) return initGated;
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

export interface AgentCardSkill {
  id?: string;
  name?: string;
  description?: string;
  examples?: string[];
  inputModes?: string[];
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
    examples?: Record<string, unknown>[];
  };
  outputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
  };
}

interface AgentCard {
  url?: string;
  supportedInterfaces?: { url: string }[];
  skills?: AgentCardSkill[];
}

// a card may declare what a skill expects; private or unreachable cards yield nothing
export async function fetchAgentCardSkills(endpoint: string, timeoutMs = 10000): Promise<AgentCardSkill[] | null> {
  if (privateEndpointReason(endpoint)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const card = (await res.json()) as AgentCard;
    return card.skills ?? null;
  } catch {
    return null;
  }
}

export interface A2aMessagePart {
  kind: "text" | "data";
  text?: string;
  data?: { input: Record<string, unknown> };
}

// Some agents read only the text part; the three chain-97 reference agents read a
// structured data part and reject JSON placed in text. Sending text always, plus
// data when the caller supplies input, keeps both audiences working.
export function buildA2aParts(task: string, input?: Record<string, unknown>): A2aMessagePart[] {
  const parts: A2aMessagePart[] = [{ kind: "text", text: task }];
  if (input) parts.push({ kind: "data", data: { input } });
  return parts;
}

// A structured input is either absent or a plain JSON object. An array, string,
// number or null is a caller mistake, refused rather than sent as a data part the
// agent cannot read.
export function normalizeDeliverInput(
  value: unknown,
): { ok: true; input?: Record<string, unknown> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "input must be a JSON object, for example {\"walletAddress\":\"0x...\"}." };
  }
  return { ok: true, input: value as Record<string, unknown> };
}

// A reply is only a deliverable if the buyer can read the agent's own content.
// The chain-97 agents answer message/send with a task envelope: the agent's words
// sit at result.task.status.message.parts and the payload at result.task.artifacts.
// A plain message reply keeps its parts at result.parts. Reading the message first
// and the artifacts last keeps the stored result the content, never the envelope.
// The whole deliverable is capped so one huge artifact cannot bloat the stored
// result and the API response; the cap is A2A_DELIVERABLE_MAX_CHARS below.
export const A2A_DELIVERABLE_MAX_CHARS = 12000;

const A2A_NO_DELIVERABLE =
  "The agent replied without a deliverable: the task carried no message text and returned no artifact content.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A text part contributes its string; a data part is the payload the buyer asked
// for, so it is kept as pretty JSON rather than dropped.
function partsToChunks(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  const chunks: string[] = [];
  for (const raw of parts) {
    if (!isRecord(raw)) continue;
    if (typeof raw.text === "string" && raw.text.trim()) chunks.push(raw.text.trim());
    else if (typeof raw.value === "string" && raw.value.trim()) chunks.push(raw.value.trim());
    else if (raw.data !== undefined) chunks.push(JSON.stringify(raw.data, null, 2));
  }
  return chunks;
}

// An artifact is normally a wrapper with parts; a few agents inline text or data.
function artifactToChunks(artifact: unknown): string[] {
  if (!isRecord(artifact)) return [];
  const fromParts = partsToChunks(artifact.parts);
  if (fromParts.length) return fromParts;
  if (typeof artifact.text === "string" && artifact.text.trim()) return [artifact.text.trim()];
  if (artifact.data !== undefined) return [JSON.stringify(artifact.data, null, 2)];
  return [];
}

export interface A2aDeliverable {
  text: string;
  found: boolean;
  state?: string;
}

export function extractA2aDeliverable(result: unknown): A2aDeliverable {
  if (!isRecord(result)) return { text: A2A_NO_DELIVERABLE, found: false };
  const task = isRecord(result.task) ? result.task : undefined;
  const taskStatus = task && isRecord(task.status) ? task.status : undefined;
  const status = taskStatus ?? (isRecord(result.status) ? result.status : undefined);
  const message = status && isRecord(status.message) ? status.message : undefined;
  const state = status && typeof status.state === "string" ? status.state : undefined;

  const chunks: string[] = [
    ...partsToChunks(message?.parts),
    ...partsToChunks(result.parts),
  ];
  const artifacts: unknown[] = [];
  if (task && Array.isArray(task.artifacts)) artifacts.push(...task.artifacts);
  if (Array.isArray(result.artifacts)) artifacts.push(...result.artifacts);
  for (const artifact of artifacts) chunks.push(...artifactToChunks(artifact));

  const seen = new Set<string>();
  const unique = chunks.filter((chunk) => {
    if (seen.has(chunk)) return false;
    seen.add(chunk);
    return true;
  });
  if (unique.length === 0) return { text: A2A_NO_DELIVERABLE, found: false, state };

  const joined = unique.join("\n");
  const text =
    joined.length > A2A_DELIVERABLE_MAX_CHARS
      ? `${joined.slice(0, A2A_DELIVERABLE_MAX_CHARS)}\n[truncated: deliverable over ${A2A_DELIVERABLE_MAX_CHARS} characters]`
      : joined;
  return { text, found: true, state };
}

async function deliverA2a(
  endpoint: string,
  task: string,
  input?: Record<string, unknown>,
): Promise<DeliverOutcome> {
  // the registry's a2a_endpoint usually points at the agent card; the messaging
  // url lives inside it
  const endpointBlocked = privateEndpointReason(endpoint);
  if (endpointBlocked) {
    return {
      protocol: "a2a",
      ok: false,
      error: `${endpointBlocked}. the agent's registry record points there, so the owner needs to publish a public endpoint.`,
    };
  }
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

  const blocked = privateEndpointReason(messagingUrl);
  if (blocked) {
    return {
      protocol: "a2a",
      ok: false,
      error: `${blocked}. the agent's card names it as the messaging url, so the owner needs to publish a public one.`,
    };
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
        parts: buildA2aParts(task, input),
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
  const sendGated = loginGatedOutcome("a2a", send.status);
  if (sendGated) return sendGated;
  if (send.body.error) {
    return { protocol: "a2a", ok: false, error: `message/send failed: ${send.body.error.message}` };
  }
  const jobSeller = jobSellerReply(send.body.result);
  if (jobSeller) return { protocol: "a2a", ok: false, gated: true, error: jobSeller };

  const extracted = extractA2aDeliverable(send.body.result);
  if (!extracted.found) {
    return { protocol: "a2a", ok: false, error: extracted.text };
  }
  if (extracted.state && extracted.state !== "completed") {
    return { protocol: "a2a", ok: false, error: extracted.text };
  }
  return { protocol: "a2a", ok: true, kind: "deliverable", text: extracted.text };
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
  skills?: AgentCardSkill[];
}

export interface DeliverInput {
  paymentId: string;
  tool?: string;
  args?: Record<string, unknown>;
  task?: string;
  input?: Record<string, unknown>;
  taskId?: string;
}

// What delivery did to the ERC-8183 job. A delivery that cannot advance its job
// reports why here instead of leaving an unexplained Funded job behind.
export interface JobAdvance {
  advanced: boolean;
  jobId?: string;
  status?: JobStatus;
  note?: string;
}

// A browser-invoked agent is a real listing, but its tools live in a browser page
// the marketplace cannot call. A settled hire that tries to deliver to one gets
// that case named, not the generic empty-endpoint line, so the buyer knows why.
export const BROWSER_INVOKED_DELIVERY_REFUSAL =
  "This agent is browser-invoked: its tools live in a browser page, so the marketplace cannot call it. The hire settled, but nothing could be delivered.";

export const NO_ENDPOINT_DELIVERY_REFUSAL =
  "This agent has no callable endpoint registered (no MCP server, no A2A endpoint), so settlement can be recorded but nothing can be delivered.";

export function noEndpointDeliveryMessage(detail: {
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
}): string {
  return !detail.mcp_server && !detail.a2a_endpoint && detail.web_endpoint
    ? BROWSER_INVOKED_DELIVERY_REFUSAL
    : NO_ENDPOINT_DELIVERY_REFUSAL;
}

export async function deliver(input: DeliverInput): Promise<
  | (DeliverOutcome & {
      agent: { chainId: number; tokenId: string; name: string };
      paymentId: string;
      taskId?: string;
      jobAdvance?: JobAdvance;
    })
  | { ok: false; error: string; taskId?: string }
> {
  const receipt = await getPaymentDurable(input.paymentId);
  if (!receipt || !receipt.activated) {
    return { ok: false, error: "No settled session for this payment id. Hire the agent first." };
  }

  const detail = await fetchAgentDetail(receipt.agent.chainId, receipt.agent.tokenId);
  if (!detail) {
    return { ok: false, error: "Agent left the registry since the hire." };
  }

  // decide the real execution path first: MCP is preferred when registered
  let willRun = false;
  if (detail.mcp_server) {
    willRun = Boolean(input.tool);
  } else if (detail.a2a_endpoint) {
    willRun = Boolean(input.task);
  }

  let trackedId = input.taskId;
  if (!trackedId && willRun) {
    trackedId =
      (
        await ensureTaskForPayment({
          paymentId: input.paymentId,
          chainId: receipt.agent.chainId,
          tokenId: receipt.agent.tokenId,
          agentName: receipt.agent.name,
        })
      ).id;
  }
  if (willRun && trackedId) {
    markTaskRunning(trackedId, {
      tool: input.tool,
      args: input.args,
      taskText: input.task,
    });
  }

  let outcome: DeliverOutcome;
  if (detail.mcp_server) {
    outcome = await deliverMcp(detail.mcp_server, input.tool, input.args);
  } else if (detail.a2a_endpoint) {
    if (!input.task) {
      // no task yet: report the protocol and the declared skills
      outcome = {
        protocol: "a2a",
        ok: true,
        kind: "capabilities",
        tools: [],
        skills: (await fetchAgentCardSkills(detail.a2a_endpoint)) ?? undefined,
      };
    } else {
      outcome = await deliverA2a(detail.a2a_endpoint, input.task, input.input);
    }
  } else {
    const error = noEndpointDeliveryMessage(detail);
    const triedRun = Boolean(input.tool || input.task);
    if (triedRun) {
      trackedId =
        trackedId ??
        (
          await ensureTaskForPayment({
            paymentId: input.paymentId,
            chainId: receipt.agent.chainId,
            tokenId: receipt.agent.tokenId,
            agentName: receipt.agent.name,
          })
        ).id;
      markTaskRunning(trackedId, { tool: input.tool, args: input.args, taskText: input.task });
      markTaskFailed(trackedId, error);
    }
    return { ok: false, error, taskId: trackedId };
  }

  let jobAdvance: JobAdvance | undefined;
  if (willRun && trackedId) {
    if (outcome.ok && outcome.kind === "deliverable" && outcome.text && !outcome.isError) {
      markTaskDelivered(trackedId, {
        result: outcome.text,
        protocol: outcome.protocol,
        tool: input.tool,
        args: input.args,
        taskText: input.task,
      });
      // ERC-8183 Submitted: provider work is ready for evaluator attestation.
      // The job may have been opened by another instance at settle, so the lookup
      // reads the durable store rather than only this process's map.
      const job = await getJobByPaymentAsync(input.paymentId);
      if (!job) {
        // a delivered task with no job is the defect this reports: stay visible
        jobAdvance = {
          advanced: false,
          note: `delivery succeeded but no ERC-8183 job exists for payment ${input.paymentId}; the evaluator cannot attest until one does`,
        };
      } else if (job.status === "Funded") {
        // The submit resolves the job through the durable store and awaits its
        // write, so the transition cannot live only in this process's map: a
        // delivery must leave the durable job Submitted, not Funded.
        const submitted = await submitJobAsync({
          jobId: job.id,
          provider: "marketplace",
          deliverable: outcome.text.slice(0, 500),
          taskId: trackedId,
        });
        jobAdvance = {
          advanced: submitted?.status === "Submitted",
          jobId: job.id,
          status: submitted?.status ?? job.status,
        };
      } else {
        // Submitted or terminal: a second advance would overwrite the recorded
        // deliverable, so the job is left where it is and the state is reported
        jobAdvance = { advanced: false, jobId: job.id, status: job.status };
      }
    } else if (!outcome.ok || outcome.gated || outcome.isError) {
      markTaskFailed(trackedId, outcome.error ?? outcome.text ?? "delivery failed", {
        protocol: outcome.protocol,
        gated: outcome.gated,
      });
    }
  }

  return {
    ...outcome,
    agent: { chainId: receipt.agent.chainId, tokenId: receipt.agent.tokenId, name: receipt.agent.name },
    paymentId: input.paymentId,
    taskId: trackedId,
    jobAdvance,
  };
}
