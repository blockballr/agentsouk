import { CliError } from "../core/errors";
import { showAgent, type AgentSummary } from "./agents";
import type { CliConfig } from "../core/config";

// Direct calls go to the endpoint the card declares, not through the
// marketplace. The card is the source of truth, and a delisted listing is not
// callable even if its endpoint still answers.
export function assertCallableEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new CliError(`the card declares an endpoint that is not a URL: ${endpoint}`, "bad_endpoint");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !local) {
    throw new CliError(`the endpoint must be https unless it is localhost: ${endpoint}`, "bad_endpoint");
  }
  return url;
}

export function textFromResult(result: unknown): string {
  const texts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) texts.push(record.text.trim());
    for (const key of ["parts", "status", "message", "artifacts", "task"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  visit(result, 0);
  return [...new Set(texts)].join("\n");
}

export interface CallResult {
  agent: AgentSummary;
  endpoint: string;
  latencyMs: number;
  text: string;
  result: unknown;
}

export async function callAgent(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  task: string,
  options: { timeoutMs?: number } = {},
): Promise<CallResult> {
  const agent = await showAgent(config, chainId, tokenId);
  if ((agent as { delisted?: unknown }).delisted) {
    throw new CliError(`${agent.name ?? tokenId} is delisted, so it is not called`, "delisted");
  }
  const endpoint = agent.a2a_endpoint;
  if (!endpoint) {
    throw new CliError(
      `${agent.name ?? tokenId} declares no A2A endpoint; MCP calls are not built yet`,
      "no_endpoint",
    );
  }
  const url = assertCallableEndpoint(endpoint);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `souk-${started}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            messageId: `souk-${started}`,
            parts: [{ kind: "text", text: task }],
          },
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`cannot reach ${url.toString()}: ${reason}`, "network");
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // a plain text answer is a valid A2A result for some agents
  }
  if (!response.ok) {
    const record = body as { error?: { message?: string }; message?: string } | null;
    const message = record?.error?.message ?? record?.message ?? response.statusText;
    throw new CliError(`${url.toString()} answered ${response.status}: ${message}`, "call_failed");
  }
  const rpc = body as { error?: { message?: string }; result?: unknown } | null;
  if (rpc?.error) {
    throw new CliError(`the agent returned an error: ${rpc.error.message ?? "unknown"}`, "call_failed");
  }
  return {
    agent,
    endpoint: url.toString(),
    latencyMs,
    text: textFromResult(rpc?.result ?? body) || (typeof body === "string" ? body : ""),
    result: rpc?.result ?? body,
  };
}
