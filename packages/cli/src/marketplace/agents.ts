import type { CliConfig, Rail } from "../core/config";
import { apiRequest, query } from "../core/http";
import { CliError } from "../core/errors";

export interface AgentSkill {
  id?: string;
  name?: string;
}

export interface AgentSummary {
  chain_id?: number;
  token_id?: string;
  name?: string;
  category?: string | null;
  owner_address?: string | null;
  agent_wallet?: string | null;
  x402_supported?: boolean;
  total_score?: number | null;
  skills?: AgentSkill[];
  verification?: { status?: string; checkedAt?: string; responseMs?: number } | null;
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
  description?: string | null;
  vaultMinDepositUsd?: number | null;
}

export interface AgentsPage {
  items?: AgentSummary[];
  total?: number;
  page?: number;
  limit?: number;
  counts?: Record<string, number>;
}

export interface AgentDetailResponse {
  data?: AgentSummary & Record<string, unknown>;
  [key: string]: unknown;
}

function skillIds(agent: AgentSummary): string[] {
  return (agent.skills ?? [])
    .map((skill) => String(skill?.id ?? skill?.name ?? "").trim().toLowerCase())
    .filter(Boolean);
}

// the rails a listing actually qualifies for, in the order the shelf shows
// them. direct is the callable bucket outside vault and jobs, so an x402 agent
// with a card appears as direct plus x402 rather than one or the other.
export function railsOf(agent: AgentSummary): string {
  const ids = skillIds(agent);
  const vault = ids.some((id) => /^vault[-_]execution$/.test(id));
  const jobs = ids.includes("negotiate") && ids.includes("notify_funded");
  const callable = Boolean(agent.a2a_endpoint || agent.mcp_server || agent.web_endpoint);
  const direct = callable && !vault && !jobs;
  const rails: string[] = [];
  if (jobs) rails.push("jobs");
  if (vault) rails.push("vault");
  if (direct) rails.push("direct");
  if (agent.x402_supported) rails.push("x402");
  return rails.length > 0 ? rails.join(",") : "none";
}

export interface SearchOptions {
  query?: string;
  rail?: string;
  category?: string;
  sort?: string;
  limit?: number;
  page?: number;
  chainId: number;
}

export async function searchAgents(config: CliConfig, options: SearchOptions): Promise<AgentsPage> {
  const path = `/api/agents${query({
    q: options.query,
    type: options.rail,
    category: options.category && options.category !== "all" ? options.category : undefined,
    metric: options.sort,
    limit: options.limit,
    page: options.page,
    chainId: options.chainId,
  })}`;
  return apiRequest<AgentsPage>(config.apiUrl, path);
}

export async function showAgent(config: CliConfig, chainId: number, tokenId: string): Promise<AgentSummary> {
  const body = await apiRequest<AgentDetailResponse>(config.apiUrl, `/api/agents/${chainId}/${tokenId}`);
  const agent = (body.data ?? body) as AgentSummary;
  if (!agent || typeof agent !== "object" || !("token_id" in agent || "name" in agent)) {
    throw new CliError(`no agent at ${chainId}/${tokenId}`, "not_found");
  }
  return agent;
}

export interface VerifyResult {
  success?: boolean;
  verification?: { status?: string; responseMs?: number; detail?: string; checkedAt?: string };
  error?: string;
  [key: string]: unknown;
}

export async function verifyAgent(config: CliConfig, chainId: number, tokenId: string): Promise<VerifyResult> {
  return apiRequest<VerifyResult>(config.apiUrl, `/api/agents/${chainId}/${tokenId}/verify`, {
    method: "POST",
    body: {},
    timeoutMs: 60_000,
  });
}

export function parseAgentRef(ref: string, defaultChain: number): { chainId: number; tokenId: string } {
  const match = /^(?:(\d+)[/:])?(\d+)$/.exec(ref.trim());
  if (!match) {
    throw new CliError(`agent must look like <chain>/<id> or <id>, got "${ref}"`, "usage", 2);
  }
  const chainId = match[1] ? Number(match[1]) : defaultChain;
  return { chainId, tokenId: match[2] };
}

export interface OwnedAgentState {
  tokenId?: string;
  delisted?: { reason?: string; at?: string } | null;
}

// the detail route does not carry the delist state; the owner view does, so the
// listing commands read it from there
export async function ownedAgentState(
  config: CliConfig,
  chainId: number,
  owner: string,
  tokenId: string,
): Promise<OwnedAgentState | null> {
  const body = await apiRequest<{ agents?: OwnedAgentState[] }>(
    config.apiUrl,
    `/api/agents/by-owner${query({ chainId, owner })}`,
  );
  return (body.agents ?? []).find((agent) => String(agent.tokenId) === tokenId) ?? null;
}
