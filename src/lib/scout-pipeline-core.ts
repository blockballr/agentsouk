// pure scout helpers (no server-only imports) so unit tests can load them

import { classifyAgent } from "./categories";
import type { CategoryKey } from "./types";
import type { ScoutCandidate } from "./scout";

export const SCOUT_KEYWORDS: Record<CategoryKey, string[]> = {
  rebalancing: [
    "rebalanc",
    "portfolio",
    "allocation",
    "auto-rebalance",
    "rebalancing bot",
    "asset allocation",
    "portfolio management",
    "token swap",
    "dex swap",
    "liquidity rebalance",
    "portfolio rebalancer",
    "rebalance strategy",
  ],
  "grid-trading": [
    "grid trading",
    "grid bot",
    "grid order",
    "grid strategy",
    "accumulation grid",
    "dca grid",
    "automated grid",
    "spot grid",
    "range trading",
    "price grid",
    "order grid",
    "grid bot trading",
  ],
  yield: [
    "yield",
    "staking",
    "lending",
    "vault",
    "apy",
    "farming",
    "yield farming",
    "yield optimization",
    "auto-compound",
    "yield aggregator",
    "defi yield",
    "staking bot",
    "vault strategy",
  ],
  "health-factor": [
    "health factor",
    "liquidation",
    "collateral",
    "loan health",
    "position health",
    "risk management",
    "liquidation protection",
    "collateral ratio",
    "health monitor",
    "risk alert",
  ],
};

const SPAM_PATTERNS = [
  /\bEnsoul\b/i,
  /^@\S+\s+A\s*Ensoul/i,
  /twitter api.*(not configured|mock)/i,
  /seed profile/i,
  /placeholder or mock account/i,
  /dgrid\.ai/i,
  /airdrop allocation/i,
];

export function isScoutSpam(a: { name?: string | null; description?: string | null }): boolean {
  const text = `${a.name ?? ""} ${a.description ?? ""}`;
  return SPAM_PATTERNS.some((p) => p.test(text));
}

export function normalizedName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\d+$/, "")
    .slice(0, 40);
}

export function dedupeKey(agent: { name?: string | null; owner_address?: string | null }): string {
  return `${normalizedName(agent.name)}:${(agent.owner_address ?? "").toLowerCase()}`;
}

export function hasCallableEndpoint(agent: {
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
  agent_url?: string | null;
}): boolean {
  return Boolean(agent.mcp_server || agent.a2a_endpoint);
}

export type EndpointProbe = {
  tokenId: string;
  ok: boolean;
  detail: string;
  protocol?: "mcp" | "a2a" | null;
  tools?: number;
};

export function probeToVerification(
  candidate: Pick<ScoutCandidate, "token_id" | "name" | "category">,
  probe: EndpointProbe,
  responseMs: number,
): {
  tokenId: string;
  name: string;
  category: string;
  status: "delivered" | "gated" | "dead" | "unreachable";
  responseMs: number;
  checkedAt: string;
} {
  const status = probe.ok ? "delivered" : probe.detail.includes("no callable") ? "unreachable" : "dead";
  return {
    tokenId: candidate.token_id,
    name: candidate.name,
    category: candidate.category,
    status,
    responseMs,
    checkedAt: new Date().toISOString(),
  };
}

export function classifyHitText(text: string): CategoryKey | "general" {
  return classifyAgent(text).category;
}
