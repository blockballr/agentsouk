import "server-only";

import { after } from "next/server";
import {
  AgentDetail,
  AgentSummary,
  BSC_CHAIN_ID,
  CategoryKey,
  snapshotFileFor,
  targetChainId,
} from "./types";
import { classifyAgent, relevanceScore } from "./categories";
import { isPancakeSwapAgent } from "./pancakeswap";
import {
  AgentRemovedError,
  classifyLiveReadFailure,
  dueForRefresh,
  indexKey,
  shelfActionOnFailure,
  shouldAdmitSnapshotEntry,
  shouldCacheShelfAgent,
  isShelfReady,
  snapshotEndpointRegime,
  summaryFromDetail,
} from "./agent-index";
import {
  deleteShelfAgent,
  loadRegistryTotal,
  loadShelfAgents,
  saveRegistryTotal,
  saveShelfAgents,
  shelfStoreMode,
  type ShelfStoreMode,
  summaryFromRow,
} from "./shelf-store";

const BASE = "https://8004scan.io/api/v1/public";

// Give a live detail read this long before serving the snapshot instead of hanging.
const LIVE_DETAIL_TIMEOUT_MS = 5000;
const REFRESH_FETCH_TIMEOUT_MS = 6000;
// At most one live top-up per process per cooldown, so browse traffic cannot hammer the registry.
const REFRESH_COOLDOWN_MS = 60_000;
const SHELF_REFRESH_PAGES = 1;

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
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
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
  chainId: number = BSC_CHAIN_ID,
): Promise<ListResponse> {
  const params = new URLSearchParams({
    chainId: String(chainId),
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
  chainId: number = BSC_CHAIN_ID,
): Promise<{ data: unknown[]; total: number | null }> {
  const params = new URLSearchParams({
    chainId: String(chainId),
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

export interface IndexBuildTarget {
  chainId: number;
  snapshotFile: string;
}

// The build route must read and write the same chain, or a testnet build
// regenerates a mainnet snapshot the reader never opens. An explicit chain wins;
// otherwise the deployment target decides. The fallback is the target chain,
// never a hardcoded 56.
export function resolveIndexBuildTarget(
  requested?: string | number | null,
): IndexBuildTarget {
  const parsed = Number(requested);
  const chainId = Number.isFinite(parsed) && parsed > 0 ? parsed : targetChainId();
  return { chainId, snapshotFile: snapshotFileFor(chainId) };
}

export async function fetchAgentDetail(
  chainId: number,
  tokenId: string,
  timeoutMs?: number,
  signalRemoved = false,
): Promise<AgentDetail | null> {
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}`, {
    headers: authHeaders(),
    next: { revalidate: 60 },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  if (!res.ok) {
    // opt-in only: the by-id reader treats a missing record as a removal, while
    // the other callers keep reading a missing detail as null
    if (signalRemoved && (res.status === 404 || res.status === 410)) {
      throw new AgentRemovedError(res.status);
    }
    return null;
  }
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
    // the shelf gate judges reachability from these, so normalize absent to null
    a2a_endpoint: raw.a2a_endpoint ?? null,
    mcp_server: raw.mcp_server ?? null,
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
  refreshing: boolean;
  lastRefreshAt: number | null;
  lastTopUpAt: number | null;
  lastWarmAt: number | null;
  // the committed snapshot's own size, and the registry total it recorded, if any
  snapshotTotal: number | null;
  snapshotRegistryTotal: number | null;
  // the registry total the shared store last reported for this chain; null until
  // one has been observed anywhere, never a per-process live figure
  storedRegistryTotal: number | null;
  // the last registry pagination total a live read saw, used only without a snapshot
  liveUpstreamTotal: number | null;
  error: string | null;
}

const index: IndexState = {
  agents: new Map(),
  warmedPages: new Set(),
  totalFetched: 0,
  warming: false,
  refreshing: false,
  lastRefreshAt: null,
  lastTopUpAt: null,
  lastWarmAt: null,
  snapshotTotal: null,
  snapshotRegistryTotal: null,
  storedRegistryTotal: null,
  liveUpstreamTotal: null,
  error: null,
};

interface SnapshotSource {
  pages?: number;
  fetched: number;
  // The upstream total the build observed. A curated snapshot can carry its own
  // shelf size here, so it is never read as a registry total.
  upstreamTotal: number | null;
  deduped: number;
  scoutAdded?: number;
  // The registry total recorded at build time, when the writer knew it. This is the
  // only denominator a fresh instance and a topped-up one can agree on.
  registryTotal?: number | null;
}

interface SnapshotFile {
  version: number;
  snapshotTime: string;
  source: SnapshotSource;
  counts: Record<string, number>;
  agents: AgentSummary[];
}

export interface ShelfCounts {
  // Agents held in the committed snapshot. Null means no snapshot was loaded.
  snapshotTotal: number | null;
  // Agents the registry reports for the served chain. Null means unknown.
  registryTotal: number | null;
}

function nonNegativeCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

// A registry cannot have zero agents, so zero is no total and is reported as
// unknown rather than as an "of 0" denominator.
function positiveCount(value: number | null | undefined): number | null {
  const count = nonNegativeCount(value);
  return count !== null && count > 0 ? count : null;
}

// A fresh instance reads the committed snapshot while a topped-up instance reads the
// live registry, so the denominator must be something both can see. The shared stored
// value wins, then the registry total the snapshot recorded, then unknown. A live
// pagination total is used only when there is no snapshot to disagree with, so it can
// never make two instances serving the same snapshot report different denominators.
export function resolveShelfCounts(input: {
  snapshotAgents: number | null;
  snapshotRegistryTotal: number | null;
  storedRegistryTotal?: number | null;
  liveUpstreamTotal: number | null;
}): ShelfCounts {
  const snapshotTotal = nonNegativeCount(input.snapshotAgents);
  const stored = positiveCount(input.storedRegistryTotal);
  if (snapshotTotal !== null) {
    return {
      snapshotTotal,
      registryTotal: stored ?? positiveCount(input.snapshotRegistryTotal),
    };
  }
  return {
    snapshotTotal: null,
    registryTotal: stored ?? positiveCount(input.liveUpstreamTotal),
  };
}

let snapshotLoaded = false;
let snapshotTime: string | null = null;
// The shared store is read once per process and again on the refresh cadence,
// never per request.
let durableMerged = false;
let durableReadAt: number | null = null;
let registryTotalLoaded = false;

// force the next query to re-read the snapshot file (used after scout curation)
export function invalidateSnapshot(): void {
  snapshotLoaded = false;
  durableMerged = false;
  registryTotalLoaded = false;
}

// Merge the fleet's durable shelf over whatever is already in memory. A read
// runs once per process unless forced, so a browse cannot turn the database into
// the new bottleneck; a due refresh forces a fresh read.
async function mergeDurableShelf(force = false): Promise<number> {
  if (durableMerged && !force) return 0;
  durableMerged = true;
  durableReadAt = Date.now();
  const rows = await loadShelfAgents(targetChainId());
  let merged = 0;
  for (const row of rows) {
    const summary = summaryFromRow(row);
    // the store can hold several chains; the gate already ran, this keeps the
    // shelf to the chain this deployment serves
    if (!summary || summary.chain_id !== targetChainId()) continue;
    index.agents.set(indexKey(summary.chain_id, summary.token_id), summary);
    merged += 1;
  }
  return merged;
}

// Read the shared registry total once per process and again on the refresh
// cadence, never per request. With no store this stays null, so the denominator
// is omitted rather than guessed from whatever this process happened to see.
async function mergeRegistryTotal(force = false): Promise<void> {
  if (registryTotalLoaded && !force) return;
  registryTotalLoaded = true;
  index.storedRegistryTotal = await loadRegistryTotal(targetChainId());
}

// A live read makes the denominator real only by writing it to the shared store
// and reading it back. A figure kept in this process is what made the old field
// flicker between instances, so it is never adopted on its own.
async function observeRegistryTotal(
  chainId: number,
  total: number | null,
): Promise<void> {
  const observed = positiveCount(total);
  if (observed === null) return;
  await saveRegistryTotal(chainId, observed);
  const durable = await loadRegistryTotal(chainId);
  if (durable !== null) index.storedRegistryTotal = durable;
}

// the snapshot is the primary catalogue, and live warming only fills in when it
// is absent
async function loadSnapshot(): Promise<boolean> {
  if (snapshotLoaded) return true;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "data", snapshotFileFor(targetChainId()));
    const raw = await fs.readFile(file, "utf8");
    const snap = JSON.parse(raw) as SnapshotFile;
    index.agents.clear();
    // a snapshot that carries no endpoint data cannot be judged on one, so the
    // regime decides whether the full gate applies or only the category rule
    const regime = snapshotEndpointRegime(snap.agents);
    for (const a of snap.agents) {
      if (!shouldAdmitSnapshotEntry(a, regime)) continue;
      index.agents.set(indexKey(a.chain_id, a.token_id), a);
    }
    // The snapshot's own size, never source.upstreamTotal: a curated snapshot can
    // carry its shelf size there, so it is not a registry total.
    index.snapshotTotal = snap.agents.length;
    index.snapshotRegistryTotal = positiveCount(snap.source.registryTotal);
    index.totalFetched = snap.agents.length;
    index.lastWarmAt = Date.now();
    snapshotTime = snap.snapshotTime;
    snapshotLoaded = true;
    // overlay the shared store so an instance that never pulled still serves what
    // another instance learned
    await mergeDurableShelf();
    return true;
  } catch {
    return false;
  }
}

export interface WarmOptions {
  maxPages?: number;
  categories?: CategoryKey[];
}

// Pulls pages of recent BSC agents, classifies them, and stores them; idempotent per page,
// stops at maxPages or when upstream has no more pages.
export async function warmIndex(opts: WarmOptions = {}): Promise<void> {
  if (await loadSnapshot()) return; // curated snapshot already provides coverage
  const maxPages = opts.maxPages ?? 6;
  if (index.warming) return;
  index.warming = true;
  let observedTotal: number | null = null;
  try {
    for (let page = 1; page <= maxPages; page++) {
      if (index.warmedPages.has(page)) continue;
      let body: ListResponse;
      try {
        body = await fetchAgentsPage(page, undefined, targetChainId());
      } catch (e) {
        index.error = (e as Error).message;
        break;
      }
      index.liveUpstreamTotal = body.meta.pagination.total;
      observedTotal = positiveCount(body.meta.pagination.total);
      for (const raw of body.data) {
        index.agents.set(indexKey(raw.chain_id, raw.token_id), buildSummary(raw));
      }
      index.warmedPages.add(page);
      index.totalFetched += body.data.length;
      if (!body.meta.pagination.hasMore) break;
    }
    index.lastWarmAt = Date.now();
  } finally {
    index.warming = false;
  }
  await observeRegistryTotal(targetChainId(), observedTotal);
}

export interface RefreshReport {
  pages: number;
  fetched: number;
  added: number;
  total: number;
  upstreamTotal: number | null;
  error: string | null;
}

// Reads through to 8004scan because the committed snapshot is frozen at deploy
// time; a failed pull leaves the snapshot untouched rather than emptying the shelf.
export async function refreshIndexFromLive(
  maxPages = SHELF_REFRESH_PAGES,
): Promise<RefreshReport> {
  if (index.refreshing) {
    return {
      pages: 0,
      fetched: 0,
      added: 0,
      total: index.agents.size,
      upstreamTotal: index.liveUpstreamTotal,
      error: "refresh already running",
    };
  }
  index.refreshing = true;
  index.lastRefreshAt = Date.now();
  const chainId = targetChainId();
  const pages = Math.max(1, Math.min(10, maxPages));
  let fetched = 0;
  let added = 0;
  let done = 0;
  let error: string | null = null;
  let observedTotal: number | null = null;
  const admitted: AgentSummary[] = [];
  try {
    await loadSnapshot();
    for (let page = 1; page <= pages; page++) {
      let body: ListResponse;
      try {
        body = await fetchAgentsPage(
          page,
          AbortSignal.timeout(REFRESH_FETCH_TIMEOUT_MS),
          chainId,
        );
      } catch (e) {
        error = (e as Error).message;
        break;
      }
      index.liveUpstreamTotal = body.meta.pagination.total;
      observedTotal = positiveCount(body.meta.pagination.total);
      for (const raw of body.data) {
        const summary = buildSummary(raw);
        // Shelve only what the marketplace would stand behind: a new registration appears once it
        // has a callable endpoint and a category, never unclassified or unverifiable.
        if (!isShelfReady(summary)) continue;
        admitted.push(summary);
        const key = indexKey(summary.chain_id, summary.token_id);
        if (!index.agents.has(key)) added += 1;
        index.agents.set(key, summary);
      }
      fetched += body.data.length;
      done = page;
      if (!body.meta.pagination.hasMore) break;
    }
    // persist the admitted entries so the whole fleet, and the next process,
    // sees what this pull learned
    await saveShelfAgents(admitted);
    // the registry total this pull observed is shared too, so the denominator is
    // the same on an instance that just topped up and one that never did
    await observeRegistryTotal(chainId, observedTotal);
  } finally {
    index.refreshing = false;
    index.lastWarmAt = Date.now();
  }
  index.error = error;
  // Only a clean pull counts as a top up; a failed one leaves the clock at the
  // last time the shelf actually gained live data.
  if (error === null) index.lastTopUpAt = Date.now();
  return {
    pages: done,
    fetched,
    added,
    total: index.agents.size,
    upstreamTotal: index.liveUpstreamTotal,
    error,
  };
}

async function maybeRefreshShelf(): Promise<void> {
  if (!dueForRefresh(index.lastRefreshAt, Date.now(), REFRESH_COOLDOWN_MS)) return;
  // A due refresh is also the cadence at which this instance re-reads the fleet's
  // shared shelf. Both start together so the registry pull is not delayed behind
  // the database read; they write the same shelf shape, so the last writer wins.
  await Promise.all([
    mergeDurableShelf(true),
    refreshIndexFromLive(SHELF_REFRESH_PAGES),
  ]);
  // The top up wrote the total it observed; this re-reads it, and any other
  // instance's write, on the same cadence as the shelf re-read.
  await mergeRegistryTotal(true);
}

// Trigger the shelf top up without making the browse response wait on 8004scan.
// after() is the sanctioned mechanism and runs the work once the response is
// sent, with waitUntil keeping the invocation alive on serverless so the refresh
// is not cut off. Outside a request scope (tests, scripts, or a self-hosted
// server without waitUntil) after() throws, so fall back to a floating promise,
// which is best effort and may be cut off when the process ends.
function scheduleShelfTopUp(): void {
  const topUp = () => maybeRefreshShelf().catch(() => {});
  try {
    after(topUp);
  } catch {
    void topUp();
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
    registryTotal: number | null;
    lastWarmAt: number | null;
    // When the last successful live top up of the frozen snapshot completed, so
    // the response can report shelf freshness without waiting on the in-flight one.
    lastTopUpAt: number | null;
    warming: boolean;
    error: string | null;
    snapshotTime: string | null;
    // "shared" means the top up is backed by the durable store; "per-process"
    // means this instance only knows what it learned itself
    shelfMode: ShelfStoreMode;
    lastDurableReadAt: number | null;
  };
  categoryCounts: Record<string, number>;
}

export async function queryAgents(
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const { category, q, sort = "score", page = 1, limit = 24 } = opts;
  const chainId = targetChainId();
  const hasSnapshot = await loadSnapshot();
  // no-op once the process has merged; covers the no-snapshot path too, where
  // loadSnapshot never ran the merge
  await mergeDurableShelf();
  await mergeRegistryTotal();
  if (opts.ensureWarm && !hasSnapshot) {
    await warmIndex({ maxPages: opts.maxWarmPages ?? 6 });
  } else if (hasSnapshot) {
    // The snapshot is frozen at deploy time, so top up the newest page on a
    // cooldown without blocking the browse response on the registry.
    scheduleShelfTopUp();
  }

  // Only the target chain belongs on this shelf; a live read for another chain cannot leak in.
  const shelf = Array.from(index.agents.values()).filter((a) => a.chain_id === chainId);
  let items = shelf;

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
    all: shelf.length,
  };
  for (const a of shelf) {
    const key = a.category ?? "general";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  items = sortAgents(items, sort, category);

  const total = items.length;
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  const shelfCounts = resolveShelfCounts({
    snapshotAgents: index.snapshotTotal,
    storedRegistryTotal: index.storedRegistryTotal,
    snapshotRegistryTotal: index.snapshotRegistryTotal,
    liveUpstreamTotal: index.liveUpstreamTotal,
  });

  return {
    items: paged,
    total,
    page,
    limit,
    indexStatus: {
      totalFetched: index.totalFetched,
      snapshotTotal: shelfCounts.snapshotTotal,
      registryTotal: shelfCounts.registryTotal,
      lastWarmAt: index.lastWarmAt,
      lastTopUpAt: index.lastTopUpAt,
      warming: index.warming,
      error: index.error,
      snapshotTime,
      shelfMode: shelfStoreMode(),
      lastDurableReadAt: durableReadAt,
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
        // the UI sorts by the same total_score the card displays, so it must lead; relevance only breaks ties
        copy.sort(
          (a, b) =>
            b.total_score - a.total_score ||
            b.total_feedbacks - a.total_feedbacks ||
            relevanceScore(b, category) - relevanceScore(a, category),
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
  await loadSnapshot();
  const cached = index.agents.get(indexKey(chainId, tokenId)) ?? null;
  // A detail read still goes live and the snapshot is only the fallback, so a hung registry
  // degrades to the shelf instead of hanging the request.
  try {
    const detail = await fetchAgentDetail(chainId, tokenId, LIVE_DETAIL_TIMEOUT_MS, true);
    if (detail) {
      // Served regardless, because the caller asked for this exact agent by id; shelved only if it
      // qualifies, so a direct read cannot smuggle an unqualified listing into browse.
      if (shouldCacheShelfAgent(chainId, targetChainId()) && isShelfReady(detail)) {
        index.agents.set(
          indexKey(detail.chain_id, detail.token_id),
          summaryFromDetail(detail),
        );
      }
      return detail;
    }
  } catch (e) {
    // A definitive not-found evicts, because the registry said the agent is gone.
    // A timeout or a registry fault keeps the snapshot, because neither is evidence.
    const action = shelfActionOnFailure(classifyLiveReadFailure({ error: e }));
    if (action === "evict") {
      index.agents.delete(indexKey(chainId, tokenId));
      // remove it from the shared shelf too, or the next process start would
      // merge the delisted agent back in
      await deleteShelfAgent(chainId, tokenId);
      return null;
    }
  }
  return cached;
}
