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
    web_endpoint: detail.web_endpoint ?? null,
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

/**
 * Whether an agent belongs on the shelf: one publicly reachable endpoint and a
 * real category. A web endpoint qualifies, because a browser-invoked agent is a
 * listing worth showing; the marketplace still cannot call it, which every view
 * of it says.
 */
export function isShelfReady(a: {
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
  category?: string | null;
}): boolean {
  const classified = Boolean(a.category) && a.category !== "general";
  if (!classified) return false;
  const endpoints = [a.a2a_endpoint, a.mcp_server, a.web_endpoint].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return endpoints.some((u) => privateEndpointReason(u) === null);
}

// fetchAgentDetail returns null for every non-ok response, which folds a
// definitive removal into the same value as a registry fault. A caller serving
// exactly one agent opts into this error so a 404 can evict the snapshot entry
// instead of serving it forever; a caller that does not opt in keeps seeing null.
export class AgentRemovedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`agent is no longer on the registry (${status})`);
    this.name = "AgentRemovedError";
    this.status = status;
  }
}

// a confirmed registration is shelved before 8004scan has indexed it, so a
// not-found inside this window is the index lagging, not the agent being gone
export const FRESH_ADMISSION_MS = 24 * 60 * 60 * 1000;

export function isFreshAdmission(admittedAt: string | undefined, now = Date.now()): boolean {
  if (!admittedAt) return false;
  const at = Date.parse(admittedAt);
  return Number.isFinite(at) && now - at < FRESH_ADMISSION_MS;
}

// What a live read told us about one cached entry when it did not confirm it.
export type LiveReadFailure =
  | { kind: "not_found"; status: number | null }
  | { kind: "timeout" }
  | { kind: "error"; message?: string };

// What to do with the cached entry when the live read did not confirm it.
export type ShelfFailureAction = "evict" | "keep" | "keep_stale";

// A definitive not-found evicts. A timeout keeps the entry and marks it stale,
// because a slow agent may still be alive. Any other fault keeps the entry as it
// was, since charging our own outage to the agent would evict healthy listings.
export function shelfActionOnFailure(failure: LiveReadFailure): ShelfFailureAction {
  switch (failure.kind) {
    case "not_found":
      return "evict";
    case "timeout":
      return "keep_stale";
    case "error":
      return "keep";
  }
}

export interface LiveReadSignals {
  // HTTP status when the registry answered, null or omitted when it never did.
  status?: number | null;
  // The error the read threw, when it threw.
  error?: unknown;
}

// Folds the two things a live read leaves behind, a status and a thrown error,
// into the single failure the shelf decision understands. Anything unrecognised
// is an error, which never evicts, so a missing signal cannot delist an agent.
export function classifyLiveReadFailure(signals: LiveReadSignals): LiveReadFailure {
  if (signals.status === 404 || signals.status === 410) {
    return { kind: "not_found", status: signals.status };
  }
  if (signals.error instanceof AgentRemovedError) {
    return { kind: "not_found", status: signals.error.status };
  }
  const name = signals.error instanceof Error ? signals.error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "timeout" };
  }
  return {
    kind: "error",
    ...(signals.error instanceof Error ? { message: signals.error.message } : {}),
  };
}

// How far an entry has fallen behind its last confirmation. "stale" keeps the
// card on the page with a last-checked note; "overdue" says a live re-check is
// due before the entry is trusted again, so the page can say it is not
// responding rather than hide it.
export type ShelfFreshness = "fresh" | "stale" | "overdue" | "unknown";

export interface FreshnessWindow {
  staleAfterMs: number;
  overdueAfterMs: number;
}

// Both bounds are inclusive: the age equal to a threshold takes the later state.
// A confirmation dated in the future is clock skew, not freshness.
export function shelfFreshness(
  lastConfirmedAt: number | null,
  now: number,
  window: FreshnessWindow,
): ShelfFreshness {
  if (lastConfirmedAt === null) return "unknown";
  const age = now - lastConfirmedAt;
  if (age < window.staleAfterMs) return "fresh";
  if (age < window.overdueAfterMs) return "stale";
  return "overdue";
}

// One hour without confirmation shows a last-checked note; a day is overdue for
// a live re-check. Both sit far above the 60s refresh cooldown, so a healthy
// process never labels an entry it just topped up.
export const DEFAULT_FRESHNESS_WINDOW: FreshnessWindow = {
  staleAfterMs: 60 * 60 * 1000,
  overdueAfterMs: 24 * 60 * 60 * 1000,
};

// A committed snapshot either carries endpoint data or predates it. The chain-97
// snapshot carries endpoints on every entry; the chain-56 snapshot carries them
// on only a few, so gating that shelf on an endpoint would empty it. The regime
// is decided once for the whole snapshot, not guessed per entry from a missing
// field, so a sparse snapshot cannot silently drop its classified agents.
export type SnapshotEndpointRegime = "endpoints-available" | "no-endpoints";

export interface EndpointBearing {
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
}

function carriesEndpoint(a: EndpointBearing): boolean {
  return (
    (typeof a.a2a_endpoint === "string" && a.a2a_endpoint.length > 0) ||
    (typeof a.mcp_server === "string" && a.mcp_server.length > 0) ||
    (typeof a.web_endpoint === "string" && a.web_endpoint.length > 0)
  );
}

// Endpoints count as available only when a strict majority of entries carry one,
// so a handful of scout-added rows on an otherwise endpoint-less snapshot cannot
// flip the shelf into endpoint gating and drop the rest.
export function snapshotEndpointRegime(
  agents: readonly EndpointBearing[],
): SnapshotEndpointRegime {
  if (agents.length === 0) return "no-endpoints";
  const withEndpoint = agents.filter(carriesEndpoint).length;
  return withEndpoint * 2 > agents.length ? "endpoints-available" : "no-endpoints";
}

// Admits a committed snapshot entry under the same gate as a live one where the
// snapshot carries endpoints. Where it does not, the endpoint requirement is
// dropped and a real category is required, so an endpoint-less shelf keeps its
// classified entries instead of being wiped by a field it never captured.
export function shouldAdmitSnapshotEntry(
  entry: EndpointBearing & { category?: string | null },
  regime: SnapshotEndpointRegime,
): boolean {
  if (regime === "no-endpoints") {
    return Boolean(entry.category) && entry.category !== "general";
  }
  return isShelfReady(entry);
}
