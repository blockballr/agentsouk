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
import { isPancakeSwapAgent, readsPancakeSwap } from "./pancakeswap";
import { privateEndpointReason } from "./endpoint";
import { captureAgentSkills } from "./agent-interface";
import { firstPartyDescription, firstPartySkills, firstPartyVaultOnly, firstPartyWallet } from "./first-party-copy";
import { loadDelisted } from "./delist-store";
import { rotationSeed, withoutHouseAgents, reachabilityCompare, reachabilityRankCompare } from "./working-rotation";
import { LISTABLE_CATEGORIES, takesJobs, takesVault, type RegistrationDraft } from "@agora/core";
import {
  AgentRemovedError,
  classifyLiveReadFailure,
  dueForRefresh,
  indexKey,
  isFreshAdmission,
  canExecute,
  shelfActionOnFailure,
  shouldAdmitSnapshotEntry,
  shouldCacheShelfAgent,
  isShelfReady,
  snapshotEndpointRegime,
  summaryFromDetail,
} from "./agent-index";
import {
  deleteShelfAgent,
  loadCatalogueMeta,
  loadRegistryTotal,
  loadShelfAgents,
  readShelfAgent,
  readShelfAgents,
  readShelfVersion,
  saveCatalogueMeta,
  saveRegistryTotal,
  saveShelfAgents,
  shelfStoreMode,
  type CatalogueMeta,
  type CatalogueMetaInput,
  type DurableShelfRead,
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
// the shelf gate reads endpoint fields the upstream list payload does not
// carry, so admit a fresh record from its detail read; at most these per
// top up, sized so the eligible declarers of one sweep catch up in days
const ENDPOINT_HYDRATE_PER_TOPUP = 12;
// A store read is trusted this long, so a listing another instance admitted shows
// up within half a minute without every browse re-reading the database.
const SHELF_STORE_TTL_MS = 30_000;
// a shelf smaller than one page is worth the registry pages warming costs
const WARM_FLOOR = 24;

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
  // present on the upstream list payload, absent from the snapshot era shape.
  // the shelf gate reads it as the signal a detail record is worth reading
  supported_protocols?: string[];
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
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

// A web service is neither A2A nor MCP, so the registry gives it no dedicated
// field. It appears either in the normalized services object keyed by protocol
// or in the raw offchain registration file, so read whichever is present.
function webEndpointFromDetail(data: AgentDetail): string | null {
  const services = data.services;
  if (services && typeof services === "object" && !Array.isArray(services)) {
    const web = (services as Record<string, unknown>).web;
    if (web && typeof web === "object" && !Array.isArray(web)) {
      const endpoint = (web as Record<string, unknown>).endpoint;
      if (typeof endpoint === "string" && endpoint.length > 0) return endpoint;
    }
  }
  const offchain = data.raw_metadata?.offchain_content;
  const list =
    offchain && typeof offchain === "object" && !Array.isArray(offchain)
      ? (offchain as Record<string, unknown>).services
      : undefined;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry as Record<string, unknown>).name;
      if (typeof name !== "string" || name.toLowerCase() !== "web") continue;
      const endpoint = (entry as Record<string, unknown>).endpoint;
      if (typeof endpoint === "string" && endpoint.length > 0) return endpoint;
    }
  }
  return null;
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
  const canonical = firstPartyDescription(chainId, tokenId);
  if (canonical) data.description = canonical;
  const canonicalWallet = firstPartyWallet(chainId, tokenId);
  if (canonicalWallet) data.agent_wallet = canonicalWallet;
  if (firstPartyVaultOnly(chainId, tokenId)) data.x402_supported = false;
  const canonicalSkills = firstPartySkills(chainId, tokenId);
  if (canonicalSkills) data.skills = canonicalSkills;
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
  data.web_endpoint = webEndpointFromDetail(data);
  data.supported_trust_models = Array.isArray(data.supported_trust_models)
    ? data.supported_trust_models
    : [];
  // 8004scan does not always copy agentWallet from the card into its own
  // column. The card is the registry document the owner published, so the
  // wallet it names answers when the column is empty.
  if (!data.agent_wallet) {
    const declared = data.raw_metadata?.offchain_content?.agentWallet;
    const onchain = data.raw_metadata?.onchain?.find(
      (entry) => entry.key === "agentWallet",
    )?.value;
    const value =
      typeof declared === "string"
        ? declared.trim()
        : typeof onchain === "string"
          ? onchain.trim()
          : "";
    if (/^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)) {
      data.agent_wallet = value;
    }
  }
  // 8004scan stores the token URI but not the endpoints the card speaks. Its
  // a2a_endpoint and mcp_server fall back to the token URI, which is a GET
  // route, so an A2A message or an MCP initialize sent there cannot land.
  const cardUri = data.raw_metadata?.offchain_uri;
  const atCard = (value: string | null) => !value || value === cardUri;
  // Our house cards live at <origin>/api/<slug>/.well-known/agent-card.json
  // and serve A2A and MCP at sibling routes, so the real endpoints are
  // recoverable from the card URI without a network call.
  const slugMatch = cardUri ? cardUri.match(/\/api\/([^/]+)\/\.well-known\/agent-card\.json$/) : null;
  const derivedA2a = slugMatch ? cardUri!.replace(/\/\.well-known\/agent-card\.json$/, "/a2a") : null;
  const derivedMcp = slugMatch ? cardUri!.replace(/\/\.well-known\/agent-card\.json$/, "/mcp") : null;
  if (atCard(data.a2a_endpoint) && derivedA2a && !privateEndpointReason(derivedA2a)) {
    data.a2a_endpoint = derivedA2a;
  }
  if (atCard(data.mcp_server)) {
    let mcp: string | null = derivedMcp && !privateEndpointReason(derivedMcp) ? derivedMcp : null;
    // try the live card first, in case it names a different MCP route
    if (!mcp && cardUri && !privateEndpointReason(cardUri)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(cardUri, { next: { revalidate: 60 }, signal: controller.signal });
        if (res.ok) {
          const body = (await res.json()) as { services?: unknown };
          const list = Array.isArray(body?.services) ? body.services : [];
          for (const entry of list) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as { name?: unknown; endpoint?: unknown };
            if (typeof record.name !== "string" || record.name.toLowerCase() !== "mcp") continue;
            const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
            if (endpoint && !privateEndpointReason(endpoint)) {
              mcp = endpoint;
              break;
            }
          }
        }
      } catch {
        // fall through to the derived sibling route
      } finally {
        clearTimeout(timer);
      }
    }
    if (mcp) data.mcp_server = mcp;
  }
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
    web_endpoint: raw.web_endpoint ?? null,
    category,
    categoryScores: scores,
  };
}

// The tab the lister chose in the form, or null when the claim carries nothing to
// file under. The claim outlives the form, so the value is checked again here.
function declaredCategory(value: string | null | undefined): CategoryKey | null {
  if (!value) return null;
  return (LISTABLE_CATEGORIES as readonly string[]).includes(value)
    ? (value as CategoryKey)
    : null;
}

// A confirmed registration is a chain fact; whether our shelf will carry it is a
// separate judgement. Build the summary the shelf stores from what the lister
// declared and what the chain minted. Fields the chain cannot report for a
// brand-new token (feedback, verification) take the zero state of that token,
// never an invented value.
export function summaryFromRegistration(input: {
  chainId: number;
  tokenId: string;
  owner: string;
  registry: string;
  draft: RegistrationDraft;
  createdAt: string;
}): AgentSummary {
  const draft = input.draft;
  const name = (draft.name ?? "").trim();
  const description = (draft.description ?? "").trim();
  const endpoint = (draft.endpoint ?? "").trim();
  // a listing may speak more than one protocol, so collect every selected kind
  // (falling back to the legacy single kind, then web) and set each endpoint
  const kinds =
    draft.endpointKinds && draft.endpointKinds.length > 0
      ? draft.endpointKinds
      : draft.endpointKind
        ? [draft.endpointKind]
        : ["web"];
  // The lister picks the shelf in the form, so that choice is what files the
  // agent. The classifier only fills in when the form carried nothing to file it
  // under, and its reading stays in categoryScores so the two remain comparable.
  const declared = declaredCategory(draft.category);
  const classified = classifyAgent(`${name} ${description}`.trim());
  const category = declared ?? classified.category;
  return {
    agent_id: `${input.chainId}:${input.registry.toLowerCase()}:${input.tokenId}`,
    token_id: input.tokenId,
    chain_id: input.chainId,
    contract_address: input.registry.toLowerCase(),
    owner_address: input.owner,
    name,
    description: description || null,
    image_url: draft.image?.trim() ? draft.image.trim() : null,
    is_verified: false,
    star_count: 0,
    x402_supported: draft.x402Support ?? true,
    total_score: 0,
    average_score: 0,
    total_feedbacks: 0,
    health_score: null,
    supported_trust_models: [],
    a2a_endpoint: kinds.includes("A2A") && endpoint ? endpoint : null,
    mcp_server: kinds.includes("MCP") && endpoint ? endpoint : null,
    web_endpoint: kinds.includes("web") && endpoint ? endpoint : null,
    is_active: true,
    created_at: input.createdAt,
    category,
    categoryScores: classified.scores,
    ...(declared ? { declared_category: declared } : {}),
  };
}

// Why the shelf will not carry this agent, in the lister's terms, so a refusal
// comes back as a sentence rather than silence.
export function shelfRefusalReason(a: {
  category?: string | null;
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
}): string {
  if (!a.category || a.category === "general") {
    return "no category was chosen for it and the classifier reads the name and description as general, so the shelf has no category to file it under";
  }
  const endpoints = [a.a2a_endpoint, a.mcp_server, a.web_endpoint].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  if (endpoints.length === 0) {
    return "it declares no endpoint at all: no MCP server, no A2A endpoint and no web service URL";
  }
  const reasons = endpoints
    .map((u) => privateEndpointReason(u))
    .filter((r): r is string => r !== null);
  if (reasons.length > 0) {
    return `its endpoint is not publicly reachable: ${reasons[0] ?? "unknown endpoint fault"}`;
  }
  // every endpoint it declares is public, and a browser page is not callable:
  // the shelf lists work a hire can execute, so this one stays off it
  const callable = [a.a2a_endpoint, a.mcp_server].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  if (callable.length === 0) {
    return "it only publishes a browser page, which the marketplace cannot call, so the shelf does not list it: publish an MCP server or an A2A endpoint and it can be hired";
  }
  return "";
}

// A later re-read of the text must not undo the shelf the owner chose at
// registration, and the reading from the text stays in categoryScores for it.
function keepDeclared(next: AgentSummary): AgentSummary {
  const declared =
    next.declared_category ??
    index.agents.get(indexKey(next.chain_id, next.token_id))?.declared_category;
  if (!declared) return next;
  return { ...next, declared_category: declared, category: declared };
}

// Which side of the catalogue is serving: the shared store, or the committed file.
export type CatalogueSource = "store" | "snapshot";

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
  // the shared catalogue's own refresh time, from the store's meta; null until a
  // refresh has recorded one, so the page falls back to the snapshot's date
  catalogueRefreshedAt: string | null;
  // "store" once the shared store holds this chain's rows, otherwise the snapshot
  catalogueSource: CatalogueSource;
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
  catalogueRefreshedAt: null,
  catalogueSource: "snapshot",
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
// The shared store is read at process start and again past the store TTL, never
// per request.
let durableMerged = false;
let durableReadAt: number | null = null;
// the store's fingerprint when the rows in memory were read, so an unchanged shelf is not re-read
let durableVersion: string | null = null;
// Seeding is a once-per-process act, so a store that stays empty after the write
// is not re-seeded on every store TTL.
let seededStore = false;
let registryTotalLoaded = false;

// force the next query to re-read the snapshot file (used after scout curation)
export function invalidateSnapshot(): void {
  snapshotLoaded = false;
  durableMerged = false;
  durableReadAt = null;
  durableVersion = null;
  registryTotalLoaded = false;
}

// A store read reports whether it actually ran, so an unavailable database's
// empty result is never taken for an empty catalogue.
async function readDurableShelf(chainId: number): Promise<DurableShelfRead> {
  try {
    return await readShelfAgents(chainId);
  } catch {
    // a store module without the status reader cannot prove the shelf is empty,
    // so the plain read's empty result is reported as an unsuccessful read
    return { rows: await loadShelfAgents(chainId), ok: false };
  }
}

// a store module without the fingerprint reader, or one that fails, just means a full read
async function readShelfFingerprint(chainId: number): Promise<string | null> {
  try {
    return await readShelfVersion(chainId);
  } catch {
    return null;
  }
}

// The store is the catalogue, so when it holds no rows for this chain but the
// snapshot does, seed it once. Never deletes, and never runs on a read that
// failed, because an unavailable database is not an empty catalogue.
async function seedStoreFromSnapshot(chainId: number): Promise<void> {
  if (seededStore) return;
  const snapshotAgents = Array.from(index.agents.values()).filter(
    (a) => a.chain_id === chainId,
  );
  if (snapshotAgents.length === 0) return;
  seededStore = true;
  await saveShelfAgents(snapshotAgents);
  index.catalogueSource = "store";
}

// Read the store's own refresh record. A missing or unreadable record leaves the
// time unknown rather than inventing one.
async function readCatalogueMeta(
  chainId: number,
): Promise<CatalogueMeta | null> {
  try {
    return await loadCatalogueMeta(chainId);
  } catch {
    // a store that cannot answer leaves the freshness claim to the snapshot
    return null;
  }
}

async function loadCatalogueMetaInto(chainId: number): Promise<void> {
  const meta = await readCatalogueMeta(chainId);
  if (meta) index.catalogueRefreshedAt = meta.refreshedAt;
}

// Merge the fleet's durable shelf over whatever is already in memory. A read
// inside the TTL is reused, so a browse cannot turn the database into the new
// bottleneck; a forced read or one past the TTL goes back to the store.
async function mergeDurableShelf(force = false): Promise<number> {
  const now = Date.now();
  if (
    durableMerged &&
    !force &&
    durableReadAt !== null &&
    now - durableReadAt < SHELF_STORE_TTL_MS
  ) {
    return 0;
  }
  const chainId = targetChainId();
  const version = await readShelfFingerprint(chainId);
  if (durableMerged && !force && version !== null && version === durableVersion) {
    durableReadAt = now;
    return 0;
  }
  durableMerged = true;
  durableReadAt = now;
  const read = await readDurableShelf(chainId);
  if (read.ok) durableVersion = version;
  let merged = 0;
  for (const row of read.rows) {
    const summary = summaryFromRow(row);
    // the store can hold several chains; the gate already ran, this keeps the
    // shelf to the chain this deployment serves
    if (!summary || summary.chain_id !== chainId) continue;
    index.agents.set(indexKey(summary.chain_id, summary.token_id), summary);
    merged += 1;
  }
  if (read.ok) {
    // rows for this chain make the store the source; an empty successful read
    // against a populated snapshot means the store still needs seeding
    if (merged > 0) index.catalogueSource = "store";
    else await seedStoreFromSnapshot(chainId);
  }
  await loadCatalogueMetaInto(chainId);
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

async function writeCatalogueMeta(
  chainId: number,
  meta: CatalogueMetaInput,
): Promise<void> {
  try {
    await saveCatalogueMeta(chainId, meta);
  } catch {
    // recording the refresh is best effort; a miss leaves the previous record
  }
}

// One write per successful refresh, after the agents are persisted: the time, the
// registry total the refresh observed and the size of the catalogue it served.
async function recordCatalogueRefresh(
  chainId: number,
  observedTotal: number | null,
  admittedCount: number,
): Promise<void> {
  const refreshedAt = new Date().toISOString();
  const shelfSize = Array.from(index.agents.values()).filter(
    (a) => a.chain_id === chainId,
  ).length;
  await writeCatalogueMeta(chainId, {
    refreshedAt,
    registryTotal: positiveCount(observedTotal) ?? index.storedRegistryTotal,
    shelfSize,
  });
  // Report only what the shared store can attest: read the record back, so an
  // in-memory refresh without a store never becomes a freshness claim.
  const meta = await readCatalogueMeta(chainId);
  if (meta) index.catalogueRefreshedAt = meta.refreshedAt;
  if (shelfStoreMode() === "shared" && admittedCount > 0) {
    index.catalogueSource = "store";
  }
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
    // populate skills for entries that never captured them, so job-capable
    // agents surface in the jobs sort and carry the executes-jobs tag. done
    // synchronously for a first batch so the first page already shows them;
    // the rest follows on later loads. skipped in tests to keep the read path
    // free of side effects
    if (process.env.NODE_ENV !== "test") {
      await captureMissingShelfSkills(targetChainId(), 12).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

async function captureMissingShelfSkills(chainId: number, limit?: number): Promise<void> {
  let missing = [...index.agents.values()].filter(
    (a) => a.chain_id === chainId && (skillsAreStale(a) || a.accessGated === undefined),
  );
  if (limit) missing = missing.slice(0, limit);
  if (missing.length === 0) return;
  const concurrency = 8;
  let i = 0;
  async function worker() {
    while (i < missing.length) {
      const s = missing[i++];
      try {
        const captured = await captureAgentSkills(s).catch(() => null);
        if (!captured) continue;
        const entry = {
          ...s,
          ...(captured.skills ? { skills: captured.skills } : {}),
          skillsAt: new Date().toISOString(),
          accessGated: captured.accessGated,
        };
        index.agents.set(indexKey(entry.chain_id, entry.token_id), entry);
        await saveShelfAgents([entry]).catch(() => {});
      } catch {
        // best effort
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()));
}



export interface ShelfAdmission {
  admitted: boolean;
  reason?: string;
}

// Admit a proven registration at once. The snapshot is loaded first so a later
// browse does not clear an entry the snapshot never carried, then the memory
// shelf serves it on this instance and the durable store carries it to the
// fleet. Refusal is a sentence, never a thrown error, because the registration
// is a chain fact and the shelf decision must not fail it.
export async function admitConfirmedAgent(
  summary: AgentSummary,
): Promise<ShelfAdmission> {
  if (!isShelfReady(summary)) {
    return { admitted: false, reason: shelfRefusalReason(summary) };
  }
  const captured = await captureAgentSkills(summary).catch(() => null);
  const entry = {
    ...summary,
    ...(captured?.skills ? { skills: captured.skills } : {}),
    ...(captured ? { skillsAt: new Date().toISOString(), accessGated: captured.accessGated } : {}),
    admitted_at: new Date().toISOString(),
  };
  await loadSnapshot();
  index.agents.set(indexKey(entry.chain_id, entry.token_id), entry);
  await saveShelfAgents([entry]);
  return { admitted: true };
}

// Persist the card skills read on a detail view, so a listing whose card changed
// after admission shows under the right shelf and badge without waiting for the
// background refresh. Best effort: the view itself never fails on this.
export async function recordShelfSkills(
  chainId: number,
  tokenId: string,
  skills: AgentSummary["skills"],
  accessGated?: boolean,
): Promise<void> {
  const key = indexKey(chainId, tokenId);
  const existing = index.agents.get(key);
  if (!existing || !skills?.length) return;
  const entry: AgentSummary = {
    ...existing,
    skills,
    skillsAt: new Date().toISOString(),
    ...(accessGated === undefined ? {} : { accessGated }),
  };
  index.agents.set(key, entry);
  await saveShelfAgents([entry]);
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
        index.agents.set(
          indexKey(raw.chain_id, raw.token_id),
          keepDeclared(buildSummary(raw)),
        );
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

// How many newly admitted agents to inspect for their declared interface per top
// up. A card fetch or MCP handshake per agent is fine for a handful, but doing it
// for a whole page would stall the pull behind dead endpoints.
const CAPTURE_PER_TOPUP = 24;

// A card may change after admission: an agent that adds the ERC-8183 job steps
// must stop being shelved as a direct-only listing. Re-read the card after this
// window so the shelf follows the card rather than freezing its first reading.
const SKILLS_TTL_MS = 6 * 60 * 60 * 1000;

function skillsAreStale(entry: { skills?: unknown[]; skillsAt?: string }): boolean {
  if (!entry.skills?.length) return true;
  if (!entry.skillsAt) return true;
  const at = Date.parse(entry.skillsAt);
  return !Number.isFinite(at) || Date.now() - at > SKILLS_TTL_MS;
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
  let hydrated = 0;
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
        let summary = keepDeclared(buildSummary(raw));
        // A fresh record always fails the shelf gate here: the list payload
        // carries no endpoint fields to judge. When it declares a service,
        // read its detail once and judge the shelf on that record instead.
        if (
          !isShelfReady(summary) &&
          (raw.supported_protocols ?? []).includes("A2A") &&
          !index.agents.has(indexKey(summary.chain_id, summary.token_id)) &&
          hydrated < ENDPOINT_HYDRATE_PER_TOPUP
        ) {
          const detail = await fetchAgentDetail(
            summary.chain_id,
            summary.token_id,
            REFRESH_FETCH_TIMEOUT_MS,
          ).catch(() => null);
          if (detail) {
            summary = keepDeclared(summaryFromDetail(detail));
            hydrated += 1;
          }
        }
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
    // capture what an agent declares about how it is called, bounded and best
    // effort, so the shelf carries it without a per-view fetch: what this pull
    // admitted first, then any entry that still declares nothing, so a snapshot
    // listing gets read eventually instead of never
    const seen = new Set<string>();
    const toCapture = [...admitted, ...index.agents.values()]
      .filter((s) => {
        const key = indexKey(s.chain_id, s.token_id);
        if (s.chain_id !== chainId || seen.has(key)) return false;
        seen.add(key);
        const stored = index.agents.get(key);
        return !stored || skillsAreStale(stored) || stored.accessGated === undefined;
      })
      .slice(0, CAPTURE_PER_TOPUP);
    for (const s of toCapture) {
      const captured = await captureAgentSkills(s).catch(() => null);
      if (!captured) continue;
      const entry = {
        ...s,
        ...(captured.skills ? { skills: captured.skills } : {}),
        skillsAt: new Date().toISOString(),
        accessGated: captured.accessGated,
      };
      index.agents.set(indexKey(s.chain_id, s.token_id), entry);
      await saveShelfAgents([entry]);
    }
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
  if (error === null) {
    index.lastTopUpAt = Date.now();
    await recordCatalogueRefresh(chainId, observedTotal, admitted.length);
  }
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
  type?: "all" | "jobs" | "x402" | "vault";
  metric?: "score" | "newest" | "feedback" | "health";
  sort?: "jobs" | "x402" | "score" | "newest" | "feedback" | "health" | "reachability";
  page?: number;
  limit?: number;
  ensureWarm?: boolean;
  maxWarmPages?: number;
  pcs?: boolean;
  verifications?: Map<string, { status?: string }>;
  // the visitor's rotation seed for "Working first"; absent, the order turns over hourly
  seed?: string | null;
  // the verifier's sweep sees the team's agents even while the shelf hides them
  includeHouse?: boolean;
  // an owner's own view keeps a delisted agent, so it can be relisted from there
  includeDelisted?: boolean;
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
    // The shared catalogue's own refresh time, from the store's meta; null when
    // the store has never recorded one, so the page falls back to the snapshot.
    catalogueRefreshedAt: string | null;
    // How many agents the catalogue actually serves on this chain: the committed
    // snapshot plus anything the shared store has added, minus the ones the sweeps
    // removed. This is the curated count, as opposed to the registry's total for
    // the chain.
    shelved: number;
    // "store" when the shared store holds this chain's rows, otherwise the
    // committed snapshot is serving.
    catalogueSource: CatalogueSource;
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
  const { category, q, type, metric, sort, page = 1, limit = 24, verifications } = opts;
  const resolvedType =
    type ??
    (sort === "x402"
      ? "x402"
      : (sort as string) === "jobs"
        ? "jobs"
        : "all");
  const resolvedMetric =
    metric ?? (["score", "newest", "feedback", "health"].includes(sort ?? "")
      ? (sort as string)
      : "score");
  const chainId = targetChainId();
  await loadSnapshot();
  // no-op once the process has merged; covers the no-snapshot path too, where
  // loadSnapshot never ran the merge
  await mergeDurableShelf();
  await mergeRegistryTotal();
  // warming is gated on the shelf's size, never on whether a snapshot file
  // exists: a store-filled shelf would otherwise fetch the registry per browse
  const held = Array.from(index.agents.values()).filter((a) => a.chain_id === chainId).length;
  if (opts.ensureWarm && held < WARM_FLOOR) {
    await warmIndex({ maxPages: opts.maxWarmPages ?? 6 });
  } else {
    // keep the catalogue fresh on a cooldown, without blocking the browse response
    scheduleShelfTopUp();
  }

  // Only the target chain belongs on this shelf; a live read for another chain cannot leak in.
  // a delisted token leaves the shelf even though its on-chain registration stands
  const delisted = await loadDelisted().catch(() => new Set<string>());
  // only the four hackathon categories are shown: an agent that did not
  // classify into one of them is not offered as hireable, so the catalog
  // carries no "unclassified" entries for the Set and Earn diversity check
  const onChain = Array.from(index.agents.values()).filter(
    (a) =>
      a.chain_id === chainId &&
      (LISTABLE_CATEGORIES as readonly string[]).includes(a.category ?? "") &&
      (opts.includeDelisted || !delisted.has(a.token_id)),
  );
  // the shelf sells work a hire can execute, so an entry the marketplace cannot
  // call is not served even when an earlier pass admitted it
  const executable = onChain.filter(canExecute);
  const shelf = opts.includeHouse ? executable : withoutHouseAgents(executable, verifications);
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
    // pancake swap surfacing: registration text, or an agent we run that reads it on
    // chain, applied after the other filters so it composes with category and search
    items = items.filter(
      (a) => readsPancakeSwap(a.chain_id, a.token_id) || isPancakeSwapAgent(a.name, a.description ?? ""),
    );
  }

  // the job-type leg of the double sort: a chosen group keeps only its own
  // agents, so the shelf shows that group rather than the whole tiered list
  if (resolvedType === "jobs") {
    items = items.filter((a) => takesJobs(a.skills));
  } else if (resolvedType === "x402") {
    items = items.filter((a) => a.x402_supported && !takesJobs(a.skills));
  } else if (resolvedType === "vault") {
    // the skill the card declares, so a listing that never published it is not
    // offered here on the strength of a vault address alone
    items = items.filter((a) => takesVault(a.skills));
  }

  const categoryCounts: Record<string, number> = {
    all: shelf.length,
  };
  for (const a of shelf) {
    const key = a.category ?? "general";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  items = sortAgents(items, resolvedType, resolvedMetric, category, verifications, rotationSeed(opts.seed));

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
      catalogueRefreshedAt: index.catalogueRefreshedAt,
      // the curated count the strap shows: classified, executable agents
      // actually served, not the raw size of the in-memory index
      shelved: shelf.length,
      catalogueSource: index.catalogueSource,
      shelfMode: shelfStoreMode(),
      lastDurableReadAt: durableReadAt,
    },
    categoryCounts,
  };
}

// the second sort leg is a chain, not a single metric: whichever the buyer
// picked leads it and the other three follow in a fixed order, so a tie never
// lands on the shelf's stored order. Reachability is not on this list because
// it is not a sort a buyer picks: it settles the last tie in every comparison.
const METRIC_CHAIN = ["newest", "score", "feedback", "health"] as const;
type MetricKey = (typeof METRIC_CHAIN)[number];

function sortAgents(
  items: AgentSummary[],
  type: string,
  metric: string,
  category?: string,
  verifications?: Map<string, { status?: string }>,
  seed: string = rotationSeed(null),
): AgentSummary[] {
  const copy = [...items];
  // the first sort is job capability: a listing that sells through the ERC-8183
  // job protocol, a direct-call x402 agent, or the rest. the selected type's
  // group leads, so the buyer can re-order which group comes first
  const group = (a: AgentSummary): number =>
    takesJobs(a.skills) ? 0 : a.x402_supported ? 1 : 2; // 0=jobs 1=x402 2=others
  const typeRank = (selected: string): number =>
    selected === "x402" ? 1 : 0;
  const leadGroup = typeRank(type);
  const order = [leadGroup, ...[0, 1, 2].filter((g) => g !== leadGroup)];
  const tier = (a: AgentSummary): number => order.indexOf(group(a));

  const metricFns: Record<MetricKey, (a: AgentSummary, b: AgentSummary) => number> = {
    score: (a, b) =>
      category && category !== "all"
        ? b.total_score - a.total_score ||
          b.total_feedbacks - a.total_feedbacks ||
          relevanceScore(b, category) - relevanceScore(a, category)
        : b.total_score - a.total_score || b.total_feedbacks - a.total_feedbacks,
    newest: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    feedback: (a, b) => b.total_feedbacks - a.total_feedbacks,
    health: (a, b) => (b.health_score ?? -1) - (a.health_score ?? -1),
  };

  const lead: MetricKey = (METRIC_CHAIN as readonly string[]).includes(metric)
    ? (metric as MetricKey)
    : "score";
  const chain = [lead, ...METRIC_CHAIN.filter((k) => k !== lead)];
  const chainFirst = (a: AgentSummary, b: AgentSummary) => {
    // reachability leads every sort: an agent that answered its last probe
    // outranks one that never was checked, so an unresponsive listing can never
    // take the top of the shelf on score alone. it is asked as rank only, leaving
    // the chosen metric to decide inside a rank, and the fuller compare settles
    // what is still tied with its rotating draw
    // Reputation (and the chosen metric) lead the sort. Reachability is not a
    // metric the buyer picks; it settles what the metrics could not, so an
    // unchecked agent with real reputation is no longer buried under a
    // delivered one with none.
    const rank = reachabilityRankCompare(a, b, verifications);
    if (rank !== 0) return rank;
    for (const key of chain) {
      const n = metricFns[key](a, b);
      if (n !== 0) return n;
    }
    return reachabilityCompare(a, b, verifications, seed);
  };

  return [...copy].sort((a, b) => tier(a) - tier(b) || chainFirst(a, b));
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
      // A live registry record can omit the web service it failed to parse, while
      // the cached summary already knows it; keep the browser-invoked label rather
      // than dropping it from a page that has been telling the truth until now.
      // The callable endpoints need the same treatment: a fresh registration is
      // admitted locally with its endpoint, and the upstream index catches up later,
      // so a missing field here is a lag rather than a removal.
      // within the freshness window the confirm-time record outranks an index that has
      // not read the document yet, so a fresh listing shows the name, words and price
      // flags its lister declared instead of the index's generated fallbacks; the
      // chain's own facts, owner and dates, stay the live read's
      const admitted = cached && isFreshAdmission(cached.admitted_at) ? cached : null;
      const merged = {
        ...detail,
        web_endpoint: detail.web_endpoint ?? cached?.web_endpoint ?? null,
        a2a_endpoint: detail.a2a_endpoint ?? cached?.a2a_endpoint ?? null,
        mcp_server: detail.mcp_server ?? cached?.mcp_server ?? null,
        ...(admitted
          ? {
              name: admitted.name || detail.name,
              description: admitted.description ?? detail.description,
              image_url: admitted.image_url ?? detail.image_url,
              x402_supported: admitted.x402_supported,
            }
          : {}),
      };
      // one-time correction for Souk Grid Pilot: it was filed under yield by the
      // 376435 is the old Souk Grid Pilot listing; its endpoint is now gone (404)
      // so the liveness sweep marks it unreachable and external indexers drop it
      // Served regardless, because the caller asked for this exact agent by id; shelved only if it
      // qualifies, so a direct read cannot smuggle an unqualified listing into browse.
      if (shouldCacheShelfAgent(chainId, targetChainId()) && isShelfReady(merged)) {
        index.agents.set(
          indexKey(merged.chain_id, merged.token_id),
          keepDeclared(summaryFromDetail(merged)),
        );
      }
      return merged;
    }
  } catch (e) {
    // A definitive not-found evicts, because the registry said the agent is gone.
    // A timeout or a registry fault keeps the snapshot, because neither is evidence.
    // A registration admitted on confirm is kept too, until the index has had a day,
    // and an instance that never loaded it asks the shared shelf before judging.
    const action = shelfActionOnFailure(classifyLiveReadFailure({ error: e }));
    if (action === "evict") {
      const known = cached ?? (await readShelfAgent(chainId, tokenId));
      if (known && isFreshAdmission(known.admitted_at)) {
        if (!cached) index.agents.set(indexKey(chainId, tokenId), known);
        return known;
      }
      index.agents.delete(indexKey(chainId, tokenId));
      // remove it from the shared shelf too, or the next process start would
      // merge the delisted agent back in
      await deleteShelfAgent(chainId, tokenId);
      return null;
    }
  }
  return cached;
}
