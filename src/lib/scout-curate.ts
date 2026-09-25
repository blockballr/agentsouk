// auto-curate: fold scout-delivered specialists into data/agents.json
// the marketplace keeps serving /agents; scout only changes what is on the shelf

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyAgent } from "./categories";
import { fetchAgentDetail } from "./scanner";
import { invalidateSnapshot } from "./scanner";
import { scoutDirFor, snapshotFileFor, targetChainId } from "./types";
import type { ScoutCandidate } from "./scout";
import type { AgentSummary, CategoryKey } from "./types";

const MAX_PER_CATEGORY = 55;
const ADD_PER_RUN = 40;

export interface ScoutVerifyRow {
  tokenId: string;
  name: string;
  category: string;
  status: string;
  responseMs: number;
  detail?: string;
}

export interface CurationResult {
  added: number;
  skipped: number;
  already: number;
  total: number;
  addedAgents: AgentSummary[];
  counts: Record<string, number>;
}

function agentsPath(chainId: number = targetChainId()): string {
  return path.join(process.cwd(), "data", snapshotFileFor(chainId));
}

function scoutPath(chainId: number = targetChainId()): string {
  return path.join(process.cwd(), "data", scoutDirFor(chainId), "candidates.json");
}

function verifyPath(chainId: number = targetChainId()): string {
  return path.join(process.cwd(), "data", scoutDirFor(chainId), "verifications.json");
}

export async function loadMarketplaceSnapshot(
  chainId: number = targetChainId(),
): Promise<{
  agents: AgentSummary[];
  raw: Record<string, unknown>;
} | null> {
  try {
    const raw = JSON.parse(await readFile(agentsPath(chainId), "utf8")) as {
      agents: AgentSummary[];
      counts?: Record<string, number>;
      source?: Record<string, unknown>;
    };
    return { agents: raw.agents ?? [], raw: raw as unknown as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function loadScoutCandidates(
  chainId: number = targetChainId(),
): Promise<ScoutCandidate[]> {
  try {
    const raw = JSON.parse(await readFile(scoutPath(chainId), "utf8")) as {
      candidates?: ScoutCandidate[];
    };
    return raw.candidates ?? [];
  } catch {
    return [];
  }
}

export async function loadScoutVerifications(
  chainId: number = targetChainId(),
): Promise<Map<string, ScoutVerifyRow>> {
  const map = new Map<string, ScoutVerifyRow>();
  try {
    const raw = JSON.parse(await readFile(verifyPath(chainId), "utf8")) as {
      results?: ScoutVerifyRow[];
    };
    for (const r of raw.results ?? []) {
      map.set(String(r.tokenId), r);
    }
  } catch {
    // also fill from the shared verifications store below
  }
  try {
    const { loadVerifications } = await import("./verifications");
    const store = await loadVerifications();
    for (const [tokenId, v] of store) {
      if (!map.has(tokenId)) {
        map.set(tokenId, {
          tokenId,
          name: "",
          category: "",
          status: v.status,
          responseMs: v.responseMs,
        });
      }
    }
  } catch {
  }
  return map;
}

export function shouldAddCandidate(input: {
  candidate: Pick<ScoutCandidate, "token_id" | "category">;
  verification?: { status?: string } | null;
  existingTokenIds: Set<string>;
  categoryCounts: Record<string, number>;
}): boolean {
  if (input.existingTokenIds.has(input.candidate.token_id)) return false;
  if (!input.verification || input.verification.status !== "delivered") return false;
  if (input.candidate.category === "general") return false;
  const key = input.candidate.category;
  return (input.categoryCounts[key] ?? 0) < MAX_PER_CATEGORY;
}

function scoreFor(verifyStatus: string, responseMs: number): number {
  if (verifyStatus !== "delivered") return 0;
  // faster live endpoints rank a little higher among newcomers
  const speed = responseMs > 0 && responseMs < 4000 ? 8 : responseMs < 10000 ? 4 : 0;
  return 24 + speed;
}

export function buildAgentSummaryFromDetail(
  detail: {
    agent_id: string;
    token_id: string;
    chain_id: number;
    contract_address: string;
    owner_address: string;
    name: string;
    description: string | null;
    image_url: string | null;
    is_verified: boolean;
    star_count?: number;
    x402_supported: boolean;
    total_score: number;
    average_score: number;
    total_feedbacks: number;
    health_score: number | null;
    supported_trust_models: string[];
    is_active: boolean;
    created_at: string;
  },
  category: CategoryKey | "general",
  scoutBoost: number,
): AgentSummary {
  const text = [detail.name, detail.description ?? "", (detail.supported_trust_models ?? []).join(" ")].join(" ");
  const cls = category === "general" ? classifyAgent(text) : { category, scores: {} };
  return {
    ...detail,
    star_count: detail.star_count ?? 0,
    category: cls.category,
    categoryScores: "scores" in cls ? (cls.scores as Partial<Record<CategoryKey, number>>) : {},
    total_score: (detail.total_score ?? 0) + scoutBoost,
  } as AgentSummary;
}

export async function autoCurateScout(chainId: number = targetChainId()): Promise<CurationResult> {
  const snapshot = await loadMarketplaceSnapshot(chainId);
  const candidates = await loadScoutCandidates(chainId);
  const verifications = await loadScoutVerifications(chainId);
  const existing = new Set((snapshot?.agents ?? []).map((a) => String(a.token_id)));
  const categoryCounts: Record<string, number> = {};
  for (const a of snapshot?.agents ?? []) {
    const key = a.category ?? "general";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  const addedAgents: AgentSummary[] = [];
  let added = 0;
  let skipped = 0;
  let already = 0;

  for (const cand of candidates) {
    if (added >= ADD_PER_RUN) break;
    if (Number(cand.chain_id) !== chainId) {
      skipped += 1;
      continue;
    }
    if (existing.has(String(cand.token_id))) {
      already += 1;
      continue;
    }
    const verification = verifications.get(String(cand.token_id)) ?? null;
    if (!shouldAddCandidate({ candidate: cand, verification, existingTokenIds: existing, categoryCounts })) {
      skipped += 1;
      continue;
    }

    const detail = await fetchAgentDetail(cand.chain_id, String(cand.token_id));
    if (!detail?.agent_id || !detail.name) {
      skipped += 1;
      continue;
    }
    const boost = scoreFor(verification?.status ?? "delivered", verification?.responseMs ?? 0);
    const summary = buildAgentSummaryFromDetail(detail, cand.category as CategoryKey, boost);
    const catKey = summary.category ?? "general";
    categoryCounts[catKey] = (categoryCounts[catKey] ?? 0) + 1;
    existing.add(String(cand.token_id));
    addedAgents.push(summary);
    added += 1;
  }

  const agents = [...(snapshot?.agents ?? []), ...addedAgents];
  const counts: Record<string, number> = { all: agents.length };
  for (const a of agents) {
    const key = a.category ?? "general";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const outFile = {
    version: 2,
    snapshotTime: new Date().toISOString(),
    source: {
      fetched: agents.length,
      upstreamTotal: (snapshot?.raw?.source as { upstreamTotal?: number } | undefined)?.upstreamTotal ?? agents.length,
      deduped: agents.length,
      scoutAdded: added,
    },
    counts,
    agents,
  };

  await mkdir(path.dirname(agentsPath(chainId)), { recursive: true });
  await writeFile(agentsPath(chainId), JSON.stringify(outFile, null, 2), "utf8");
  invalidateSnapshot();

  return {
    added,
    skipped,
    already,
    total: agents.length,
    addedAgents,
    counts,
  };
}
