import "server-only";

import {
  AgentDetail,
  AgentSummary,
  BSC_CHAIN_ID,
  CategoryKey,
} from "./types";
import { classifyAgent, relevanceScore } from "./categories";
import { isPancakeSwapAgent } from "./pancakeswap";

const BASE = "https://8004scan.io/api/v1/public";

function apiKey(): string | undefined {
  const k = process.env.EIGHT004_API_KEY;
  return k && k.length > 0 ? k : undefined;
}

function authHeaders(): Record<string, string> {
  const k = apiKey();
  return k ? { "X-API-Key": k } : {};
}

interface ListResponse {
  success: boolean;
  data: RawAgent[];
  meta: {
    pagination: { page: number; limit: number; total: number; hasMore: boolean };
  };
}

interface RawAgent {
  agent_id: string;
  token_id: string;
  chain_id: number;
  contract_address: string;
  owner_address: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_verified: boolean;
  star_count: number;
  x402_supported: boolean;
  total_score: number;
  average_score: number;
  total_feedbacks: number;
  health_score: number | null;
  supported_trust_models: string[];
  is_active: boolean;
  created_at: string;
}

interface DetailResponse {
  success: boolean;
  data: AgentDetail;
}

const PAGE_LIMIT = 100;

export async function fetchAgentsPage(
  page: number,
  signal?: AbortSignal,
): Promise<ListResponse> {
  const params = new URLSearchParams({
    chainId: String(BSC_CHAIN_ID),
    page: String(page),
    limit: String(PAGE_LIMIT),
    sort: "created_desc",
  });
  const res = await fetch(`${BASE}/agents?${params.toString()}`, {
    headers: authHeaders(),
    signal,
    // revalidate every 60s so the catalogue stays fresh
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`8004scan agents ${res.status}`);
  }
  return (await res.json()) as ListResponse;
}

export async function searchAgents(
  q: string,
  limit = 100,
): Promise<{ data: unknown[]; total: number | null }> {
  const params = new URLSearchParams({
    chainId: String(BSC_CHAIN_ID),
    search: q,
    limit: String(limit),
  });
  const res = await fetch(`${BASE}/agents?${params.toString()}`, {
    headers: authHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) return { data: [], total: null };
  const body = (await res.json()) as {
    success: boolean;
    data: unknown[];
    meta: { pagination: { total: number } };
  };
  return {
    data: body.success ? body.data : [],
    total: body.meta?.pagination?.total ?? null,
  };
}

export async function fetchAgentDetail(
  chainId: number,
  tokenId: string,
): Promise<AgentDetail | null> {
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}`, {
    headers: authHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as DetailResponse;
  if (!body.success) return null;
  const data = body.data;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const hs = data.health_status;
  const overall =
    typeof hs === "object" && hs !== null
      ? (hs as { overall_status?: unknown }).overall_status
      : undefined;
  data.health_status = typeof overall === "string" ? overall : null;
  data.a2a_endpoint = str(data.a2a_endpoint);
  data.mcp_server = str(data.mcp_server);
  data.agent_url = str(data.agent_url);
  data.supported_trust_models = Array.isArray(data.supported_trust_models)
    ? data.supported_trust_models
    : [];
  return data;
}

export async function fetchFeedbacks(
  chainId: number,
  tokenId: string,
  limit = 20,
) {
  const params = new URLSearchParams({
    chainId: String(chainId),
    tokenId,
    limit: String(limit),
  });
  const res = await fetch(`${BASE}/feedbacks?${params.toString()}`, {
    headers: authHeaders(),
    next: { revalidate: 120 },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { success: boolean; data: unknown[] };
  return body.success ? body.data : [];
}

function buildSummary(raw: RawAgent): AgentSummary {
  const classificationText = [
    raw.name,
    raw.description ?? "",
    (raw.supported_trust_models ?? []).join(" "),
  ].join(" ");
  const { category, scores } = classifyAgent(classificationText);
  return {
    ...raw,
    category,
    categoryScores: scores,
  };
}

// in-memory index, warmed lazily and living for the process lifetime

interface IndexState {
  agents: Map<string, AgentSummary>;
  warmedPages: Set<number>;
  totalFetched: number;
  warming: boolean;
  lastWarmAt: number | null;
  snapshotTotal: number | null;
  error: string | null;
}

const index: IndexState = {
  agents: new Map(),
  warmedPages: new Set(),
  totalFetched: 0,
  warming: false,
  lastWarmAt: null,
  snapshotTotal: null,
  error: null,
};

interface SnapshotFile {
  version: number;
  snapshotTime: string;
  source: { pages: number; fetched: number; upstreamTotal: number; deduped: number };
  counts: Record<string, number>;
  agents: AgentSummary[];
}

let snapshotLoaded = false;
let snapshotTime: string | null = null;

// the snapshot is the primary catalogue, and live warming only fills in when it
// is absent
async function loadSnapshot(): Promise<boolean> {
  if (snapshotLoaded) return true;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", "agents.json");
    const raw = await fs.readFile(file, "utf8");
    const snap = JSON.parse(raw) as SnapshotFile;
    index.agents.clear();
    for (const a of snap.agents) index.agents.set(a.agent_id, a);
    index.snapshotTotal = snap.source.upstreamTotal;
    index.totalFetched = snap.agents.length;
    index.lastWarmAt = Date.now();
    snapshotTime = snap.snapshotTime;
    snapshotLoaded = true;
    return true;
  } catch {
    return false;
  }
}

export interface WarmOptions {
  maxPages?: number;
  categories?: CategoryKey[];
}

// Pulls pages of recent BSC agents, classifies them, and stores them. Idempotent
// per page. Stops when maxPages reached or upstream has no more pages. Designed to
// be called on first browse and to top up coverage over time.
export async function warmIndex(opts: WarmOptions = {}): Promise<void> {
  if (await loadSnapshot()) return; // curated snapshot already provides coverage
  const maxPages = opts.maxPages ?? 6;
  if (index.warming) return;
  index.warming = true;
  try {
    for (let page = 1; page <= maxPages; page++) {
      if (index.warmedPages.has(page)) continue;
      let body: ListResponse;
      try {
        body = await fetchAgentsPage(page);
      } catch (e) {
        index.error = (e as Error).message;
        break;
      }
      index.snapshotTotal = body.meta.pagination.total;
      for (const raw of body.data) {
        index.agents.set(raw.agent_id, buildSummary(raw));
      }
      index.warmedPages.add(page);
      index.totalFetched += body.data.length;
      if (!body.meta.pagination.hasMore) break;
    }
    index.lastWarmAt = Date.now();
  } finally {
    index.warming = false;
  }
}

export interface QueryOptions {
  category?: string;
  q?: string;
  sort?: "score" | "newest" | "feedback" | "health";
  page?: number;
  limit?: number;
  ensureWarm?: boolean;
  maxWarmPages?: number;
  pcs?: boolean;
}

export interface QueryResult {
  items: AgentSummary[];
  total: number;
  page: number;
  limit: number;
  indexStatus: {
    totalFetched: number;
    snapshotTotal: number | null;
    lastWarmAt: number | null;
    warming: boolean;
    error: string | null;
    snapshotTime: string | null;
  };
  categoryCounts: Record<string, number>;
}

export async function queryAgents(
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const { category, q, sort = "score", page = 1, limit = 24 } = opts;
  const hasSnapshot = await loadSnapshot();
  if (opts.ensureWarm && !hasSnapshot) {
    await warmIndex({ maxPages: opts.maxWarmPages ?? 6 });
  }

  let items = Array.from(index.agents.values());

  if (category && category !== "all") {
    items = items.filter((a) => a.category === category);
  }
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    items = items.filter(
      (a) =>
        a.name.toLowerCase().includes(needle) ||
        (a.description ?? "").toLowerCase().includes(needle) ||
        a.owner_address.toLowerCase().includes(needle),
    );
  }
  if (opts.pcs) {
    // pancake swap surfacing: detector on registration text only, applied
    // after the other filters so it composes with category/search
    items = items.filter((a) =>
      isPancakeSwapAgent(a.name, a.description ?? ""),
    );
  }

  const categoryCounts: Record<string, number> = {
    all: index.agents.size,
  };
  for (const a of index.agents.values()) {
    const key = a.category ?? "general";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  items = sortAgents(items, sort, category);

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  return {
    items: paged,
    total,
    page,
    limit,
    indexStatus: {
      totalFetched: index.totalFetched,
      snapshotTotal: index.snapshotTotal,
      lastWarmAt: index.lastWarmAt,
      warming: index.warming,
      error: index.error,
      snapshotTime,
    },
    categoryCounts,
  };
}

function sortAgents(
  items: AgentSummary[],
  sort: string,
  category?: string,
): AgentSummary[] {
  const copy = [...items];
  switch (sort) {
    case "newest":
      copy.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      break;
    case "feedback":
      copy.sort((a, b) => b.total_feedbacks - a.total_feedbacks);
      break;
    case "health":
      copy.sort(
        (a, b) => (b.health_score ?? -1) - (a.health_score ?? -1),
      );
      break;
    case "score":
    default:
      if (category && category !== "all") {
        // within a category, fit first: a precise match beats an older generic
        // agent that merely earned reputation, and score still breaks ties
        copy.sort(
          (a, b) =>
            relevanceScore(b, category) - relevanceScore(a, category) ||
            b.total_score - a.total_score,
        );
      } else {
        copy.sort(
          (a, b) =>
            b.total_score - a.total_score ||
            b.total_feedbacks - a.total_feedbacks,
        );
      }
  }
  return copy;
}

export interface PlatformStats {
  bsc: {
    totalAgents: number;
    dailyNewAgents: number;
    totalFeedbacks: number;
    averageScore: number;
    mcpAgents: number;
    a2aAgents: number;
    oasfAgents: number;
  };
  protocol: {
    mcp: number;
    a2a: number;
    unknown: number;
  };
}

export async function fetchPlatformStats(): Promise<PlatformStats | null> {
  const res = await fetch(`${BASE}/stats`, {
    headers: authHeaders(),
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    success: boolean;
    data: {
      chain_stats?: {
        chain_id: number;
        total_agents: number;
        daily_new_agents: number;
        total_feedbacks: number;
        average_feedback_score: number;
        mcp_agents: number;
        a2a_agents: number;
        oasf_agents: number;
      }[];
      protocol_distribution?: { mcp: number; a2a: number; unknown: number };
    };
  };
  if (!body.success) return null;
  const bsc = body.data.chain_stats?.find((c) => c.chain_id === BSC_CHAIN_ID);
  return {
    bsc: {
      totalAgents: bsc?.total_agents ?? 0,
      dailyNewAgents: bsc?.daily_new_agents ?? 0,
      totalFeedbacks: bsc?.total_feedbacks ?? 0,
      averageScore: bsc?.average_feedback_score ?? 0,
      mcpAgents: bsc?.mcp_agents ?? 0,
      a2aAgents: bsc?.a2a_agents ?? 0,
      oasfAgents: bsc?.oasf_agents ?? 0,
    },
    protocol: body.data.protocol_distribution ?? { mcp: 0, a2a: 0, unknown: 0 },
  };
}

export async function getAgentByToken(
  chainId: number,
  tokenId: string,
): Promise<AgentSummary | AgentDetail | null> {
  // a fresh fetch keeps the detail page live
  const detail = await fetchAgentDetail(chainId, tokenId);
  if (detail) return detail;
  const cached = Array.from(index.agents.values()).find(
    (a) => a.token_id === tokenId && a.chain_id === chainId,
  );
  return cached ?? null;
}
