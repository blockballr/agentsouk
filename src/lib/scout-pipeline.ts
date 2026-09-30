// registry scout pipeline: discover from 8004scan and persist candidates
// pure helpers live in scout-pipeline-core.ts

import { classifyAgent } from "./categories";
import { fetchAgentsPage, fetchAgentDetail, searchAgents } from "./scanner";
import { scoutDirFor, targetChainId } from "./types";
import type { CategoryKey } from "./types";
import type { ScoutCandidate, ScoutLog } from "./scout";
import {
  SCOUT_KEYWORDS,
  hasCallableEndpoint,
  isScoutSpam,
  dedupeKey,
  probeToVerification,
  type EndpointProbe,
} from "./scout-pipeline-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export {
  SCOUT_KEYWORDS,
  hasCallableEndpoint,
  isScoutSpam,
  dedupeKey,
  normalizedName,
  probeToVerification,
} from "./scout-pipeline-core";

type RawHit = {
  agent_id: string;
  token_id: string;
  chain_id: number;
  name: string;
  description?: string | null;
  owner_address?: string | null;
  supported_trust_models?: string[];
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
  agent_url?: string | null;
};

function toCandidate(
  agent: RawHit,
  source: "keyword" | "recent" | "backfill",
  category: CategoryKey | "general",
): ScoutCandidate {
  return {
    agent_id: agent.agent_id,
    token_id: String(agent.token_id),
    chain_id: agent.chain_id ?? targetChainId(),
    name: agent.name,
    description: agent.description ?? null,
    category,
    endpoint: agent.mcp_server ?? agent.a2a_endpoint ?? agent.agent_url ?? null,
    endpointType: agent.mcp_server ? "mcp" : agent.a2a_endpoint ? "a2a" : null,
    source,
    discoveredAt: new Date().toISOString(),
  };
}

function classifyHit(agent: RawHit): CategoryKey | "general" {
  const text = [
    agent.name,
    agent.description ?? "",
    (agent.supported_trust_models ?? []).join(" "),
  ].join(" ");
  return classifyAgent(text).category;
}

export function scoutRateGapMs(): number {
  return process.env.EIGHT004_API_KEY ? 250 : 6100;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function scoutDir(chainId: number = targetChainId()): string {
  return path.join(process.cwd(), "data", scoutDirFor(chainId));
}

export async function saveScoutJson(
  name: string,
  value: unknown,
  chainId: number = targetChainId(),
): Promise<string> {
  const dir = scoutDir(chainId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  return file;
}

export async function loadScoutJson<T>(
  name: string,
  chainId: number = targetChainId(),
): Promise<T | null> {
  try {
    const raw = await readFile(path.join(scoutDir(chainId), name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface DiscoverOptions {
  maxTermsPerCategory?: number;
  recentPages?: number;
  gapMs?: number;
  limit?: number;
  chainId?: number;
}

export interface DiscoverResult {
  fetched: number;
  candidates: ScoutCandidate[];
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  log: ScoutLog;
}

export async function discoverCandidates(opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  const chain = opts.chainId ?? targetChainId();
  const gapMs = opts.gapMs ?? scoutRateGapMs();
  const termsPerCat = Math.max(1, opts.maxTermsPerCategory ?? 2);
  const recentPages = Math.max(0, opts.recentPages ?? 1);
  const maxKeep = opts.limit ?? 200;
  const startedAt = new Date().toISOString();
  const seen = new Set<string>();
  const nameOwner = new Map<string, number>();
  const candidates: ScoutCandidate[] = [];
  const errors: string[] = [];
  let fetched = 0;

  const consider = (agent: RawHit, source: "keyword" | "recent") => {
    if (!agent?.agent_id || seen.has(agent.agent_id)) return;
    seen.add(agent.agent_id);
    if (isScoutSpam(agent)) return;
    const key = dedupeKey(agent);
    const n = nameOwner.get(key) ?? 0;
    if (n >= 3) return;
    nameOwner.set(key, n + 1);
    fetched += 1;
    const category = classifyHit(agent);
    if (category === "general") return;
    // list payloads often omit mcp/a2a; verify enriches from detail
    if (candidates.length < maxKeep) {
      candidates.push(toCandidate(agent, source, category));
    }
  };

  for (const terms of Object.values(SCOUT_KEYWORDS)) {
    for (const term of terms.slice(0, termsPerCat)) {
      try {
        const res = await searchAgents(term, 100, chain);
        for (const raw of (res.data ?? []) as RawHit[]) {
          consider(raw, "keyword");
        }
      } catch (e) {
        errors.push(`search ${term}: ${(e as Error).message}`);
      }
      await sleep(gapMs);
    }
  }

  for (let page = 1; page <= recentPages; page++) {
    try {
      const body = await fetchAgentsPage(page, undefined, chain);
      for (const raw of (body.data ?? []) as RawHit[]) {
        consider(raw, "recent");
      }
    } catch (e) {
      errors.push(`page ${page}: ${(e as Error).message}`);
    }
    await sleep(gapMs);
  }

  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const c of candidates) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  }

  return {
    fetched,
    candidates,
    byCategory,
    bySource,
    log: {
      runId: `scout-${Date.now()}`,
      startedAt,
      completedAt: new Date().toISOString(),
      phase: "discover",
      discovered: candidates.length,
      verified: 0,
      tracked: 0,
      added: 0,
      pruned: 0,
      errors,
    },
  };
}

export async function probeCandidateEndpoint(candidate: ScoutCandidate): Promise<EndpointProbe> {
  const detail = await fetchAgentDetail(candidate.chain_id, candidate.token_id);
  const mcp = detail?.mcp_server ?? null;
  const a2a = detail?.a2a_endpoint ?? null;
  if (!mcp && !a2a) {
    return { tokenId: candidate.token_id, ok: false, detail: "no callable endpoint", protocol: null };
  }

  const timeout = 15000;
  try {
    if (mcp) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(mcp, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "agent-souk-scout", version: "0.1.0" },
          },
        }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      const text = await res.text();
      if (!res.ok) {
        return { tokenId: candidate.token_id, ok: false, detail: `mcp ${res.status}`, protocol: "mcp" };
      }
      const json = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
      if (json.error) {
        return {
          tokenId: candidate.token_id,
          ok: false,
          detail: json.error.message ?? "mcp error",
          protocol: "mcp",
        };
      }
      return { tokenId: candidate.token_id, ok: true, detail: "mcp initialize ok", protocol: "mcp" };
    }
    if (a2a) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(a2a, {
        headers: { accept: "application/json" },
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        return { tokenId: candidate.token_id, ok: false, detail: `a2a ${res.status}`, protocol: "a2a" };
      }
      return { tokenId: candidate.token_id, ok: true, detail: "a2a card ok", protocol: "a2a" };
    }
  } catch (e) {
    return {
      tokenId: candidate.token_id,
      ok: false,
      detail: (e as Error).message,
      protocol: mcp ? "mcp" : "a2a",
    };
  }

  return { tokenId: candidate.token_id, ok: false, detail: "probe failed", protocol: null };
}
