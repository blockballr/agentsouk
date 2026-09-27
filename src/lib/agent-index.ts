import { classifyAgent } from "./categories";
import { privateEndpointReason } from "./endpoint";
import type { AgentDetail, AgentSummary } from "./types";

// The index singleton is shared by every chain this process serves, so entries are keyed by chain and token.
export function indexKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

// A live registry record is a full AgentDetail; the shelf stores AgentSummary.
export function summaryFromDetail(detail: AgentDetail): AgentSummary {
  const text = [
    detail.name,
    detail.description ?? "",
    (detail.supported_trust_models ?? []).join(" "),
  ].join(" ");
  const { category, scores } = classifyAgent(text);
  return {
    agent_id: detail.agent_id,
    token_id: detail.token_id,
    chain_id: detail.chain_id,
    contract_address: detail.contract_address,
    owner_address: detail.owner_address,
    name: detail.name,
    description: detail.description,
    image_url: detail.image_url,
    is_verified: detail.is_verified,
    star_count: 0,
    x402_supported: detail.x402_supported,
    total_score: detail.total_score,
    average_score: detail.average_score,
    total_feedbacks: detail.total_feedbacks,
    health_score: detail.health_score,
    supported_trust_models: detail.supported_trust_models ?? [],
    a2a_endpoint: detail.a2a_endpoint,
    mcp_server: detail.mcp_server,
    is_active: detail.is_active,
    created_at: detail.created_at,
    category,
    categoryScores: scores,
    ...(detail.verification ? { verification: detail.verification } : {}),
    ...(detail.pcs ? { pcs: true } : {}),
  };
}

// cached only for the target chain, so foreign probes cannot grow the map
export function shouldCacheShelfAgent(chainId: number, target: number): boolean {
  return chainId === target;
}

// Bounds registry traffic: the shelf self-refreshes at most this often per process.
export function dueForRefresh(
  lastRefreshAt: number | null,
  now: number,
  cooldownMs: number,
): boolean {
  if (lastRefreshAt === null) return true;
  return now - lastRefreshAt >= cooldownMs;
}

/** Whether an agent belongs on the shelf: one publicly reachable endpoint and a real category. */
export function isShelfReady(a: {
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  category?: string | null;
}): boolean {
  const classified = Boolean(a.category) && a.category !== "general";
  if (!classified) return false;
  const endpoints = [a.a2a_endpoint, a.mcp_server].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return endpoints.some((u) => privateEndpointReason(u) === null);
}
