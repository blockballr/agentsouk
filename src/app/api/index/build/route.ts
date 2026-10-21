import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  fetchAgentDetail,
  fetchAgentsPage,
  resolveIndexBuildTarget,
  searchAgents,
} from "@/lib/scanner";
import { classifyAgent, relevanceScore } from "@/lib/categories";
import { AgentDetail, AgentSummary, CATEGORY_KEYS, CategoryKey } from "@/lib/types";
import { applySeededEndpoints } from "@/lib/seeded-endpoints";
import { loadSeededEndpoints } from "@/lib/endpoint-store";

export const dynamic = "force-dynamic";

// POST /api/index/build?per=40&chain=97&secret=...
// writes a balanced snapshot of real, live ERC-8004 agents to the target
// chain's snapshot file (data/agents.json on 56, data/agents-97.json on 97)
// targeted keyword searches stand in for the unreliable semantic backend, and
// the newest pages add freshness and general diversity
// requests fan out in parallel batches within the active tier's rate limits
// EIGHT004_API_KEY raises the ceiling from anonymous (10 req/min, ~10
// results/search) to 500 req/min

const CATEGORY_TERMS: Record<CategoryKey, string[]> = {
  rebalancing: ["rebalanc", "liquidity range", "concentrated liquidity", "LP range"],
  "grid-trading": ["grid trading", "grid bot", "dca bot", "grid strategy", "spot grid", "trading bot", "automated trading", "quant bot"],
  yield: ["yield", "yield optimizer", "staking", "farming", "APY"],
  "health-factor": ["health factor", "liquidation", "lending", "borrow", "liquidation protection", "aave", "venus", "collateral", "risk monitor"],
};

// auto-registered spam cohorts (mock Twitter-profile agents, dgrid.ai airdrop
// farmers) that keyword search keeps surfacing
// their names and descriptions give them away
const SPAM_PATTERNS = [
  /\bEnsoul\b/i,
  /^@\S+\s+A\s*Ensoul/i,
  /twitter api.*(not configured|mock)/i,
  /seed profile/i,
  /placeholder or mock account/i,
  /dgrid\.ai/i,
  /airdrop allocation/i,
];

function isSpam(a: { name: string; description: string | null }): boolean {
  const text = `${a.name} ${a.description ?? ""}`;
  return SPAM_PATTERNS.some((p) => p.test(text));
}

const GENERAL_PAGES = 12;
const IS_ANON = !process.env.EIGHT004_API_KEY;
const BATCH = IS_ANON ? 8 : 24;
const GAP_MS = IS_ANON ? 6100 : 200;
const DETAIL_TIMEOUT_MS = 6000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizedName(name: string): string {
  // strip trailing digits ("BORT Liquidity Bloom #10966" -> "bortliquiditybloom")
  // so numbered batch registrations collapse and dedup at most 3 of them
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/\d+$/, "")
    .slice(0, 40);
}

async function fetchInBatches(
  jobs: { label: string; run: () => Promise<{ data: RawLike[]; total?: number | null }> }[],
): Promise<{ label: string; data: RawLike[]; total?: number | null }[]> {
  const out: { label: string; data: RawLike[]; total?: number | null }[] = [];
  for (let i = 0; i < jobs.length; i += BATCH) {
    const chunk = jobs.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      chunk.map((j) =>
        j.run().then((v) => ({ label: j.label, ...v })),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") out.push(s.value);
      else out.push({ label: "?", data: [], total: null });
    }
    if (i + BATCH < jobs.length) await sleep(GAP_MS);
  }
  return out;
}

// Read detail records in the same paced batches the list reads use, so one key's
// rate limit is never spent twice over. A read that fails is carried as a null
// rather than dropping the rest: a hole in one listing is not a reason to lose
// the whole sweep.
async function fetchDetails(chainId: number, tokenIds: string[]): Promise<(AgentDetail | null)[]> {
  const out: (AgentDetail | null)[] = [];
  for (let i = 0; i < tokenIds.length; i += BATCH) {
    const chunk = tokenIds.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      chunk.map((tokenId) => fetchAgentDetail(chainId, tokenId, DETAIL_TIMEOUT_MS)),
    );
    for (const s of settled) out.push(s.status === "fulfilled" ? s.value : null);
    if (i + BATCH < tokenIds.length) await sleep(GAP_MS);
  }
  return out;
}

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const configured = process.env.INDEX_SECRET;
  if (!configured) {
    return NextResponse.json(
      { success: false, error: "index secret is not configured" },
      { status: 503 },
    );
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  const secret = bearer;
  if (!secret || secret !== configured) {
    return NextResponse.json({ success: false, error: "bad secret" }, { status: 401 });
  }

  const perCategory = Math.min(60, Math.max(5, Number(sp.get("per") ?? 40) || 40));
  // An explicit chain wins; otherwise the deployment target. The fetch chain and
  // the output file come from the same value, so a chain-97 run never reads 56
  // nor writes the mainnet snapshot.
  const buildTarget = resolveIndexBuildTarget(sp.get("chain"));
  const chainId = buildTarget.chainId;

  const jobs: { label: string; run: () => Promise<{ data: RawLike[]; total?: number | null }> }[] = [];

  for (const key of CATEGORY_KEYS) {
    for (const term of CATEGORY_TERMS[key]) {
      jobs.push({
        label: `search:${key}:${term}`,
        run: async () => {
          const r = await searchAgents(term, 100, chainId);
          return { data: r.data as RawLike[], total: r.total };
        },
      });
    }
  }
  for (let p = 1; p <= GENERAL_PAGES; p++) {
    jobs.push({
      label: `pages:${p}`,
      run: async () => {
        const r = await fetchAgentsPage(p, undefined, chainId);
        return { data: r.data as RawLike[], total: r.meta.pagination.total };
      },
    });
  }

  const results = await fetchInBatches(jobs);

  const byId = new Map<string, AgentSummary>();
  let fetched = 0;
  let upstreamTotal: number | null = null;
  // Only a plain page read is scoped to the chain, so only its pagination total is
  // the chain's registry total. A search total counts matches for that term and is
  // honest for upstreamTotal but can never be recorded as a registry total.
  let registryTotal: number | null = null;

  for (const { label, data, total } of results) {
    if (total) {
      upstreamTotal = total;
      if (label.startsWith("pages:") && total > 0) registryTotal = total;
    }
    for (const raw of data) {
      fetched++;
      byId.set(raw.agent_id, buildSummary(raw));
    }
  }

  // dedupe at most 3 per normalized name and drop spam before selection, so
  // neither can fill a category
  const nameCount = new Map<string, number>();
  const ownerNameSeen = new Set<string>();
  const deduped: AgentSummary[] = [];
  for (const raw of byId.values()) {
    if (isSpam(raw)) continue;
    const n = normalizedName(raw.name);
    const key = `${n}:${raw.owner_address}`;
    const kept = nameCount.get(n) ?? 0;
    if (kept >= 3) continue;
    if (ownerNameSeen.has(key)) continue;
    nameCount.set(n, kept + 1);
    ownerNameSeen.add(key);
    deduped.push(raw);
  }

  const pools: Record<string, AgentSummary[]> = { general: [] };
  for (const k of CATEGORY_KEYS) pools[k] = [];
  for (const a of deduped) pools[a.category ?? "general"].push(a);

  const rank = (a: AgentSummary) => relevanceScore(a, a.category ?? "general");

  const selected: AgentSummary[] = [];
  const taken = new Set<string>();
  const counts: Record<string, number> = {};

  const take = (a: AgentSummary) => {
    if (taken.has(a.agent_id)) return false;
    taken.add(a.agent_id);
    selected.push(a);
    counts[a.category ?? "general"] = (counts[a.category ?? "general"] ?? 0) + 1;
    return true;
  };

  for (const k of CATEGORY_KEYS) {
    const pool = (pools[k] ?? []).slice().sort((a, b) => rank(b) - rank(a));
    for (const a of pool) {
      if ((counts[k] ?? 0) >= perCategory) break;
      take(a);
    }
  }

  const general = (pools.general ?? []).slice().sort((a, b) => rank(b) - rank(a));
  const generalTarget = Math.max(16, Math.floor(perCategory / 2));
  for (const a of general) {
    if ((counts.general ?? 0) >= generalTarget) break;
    take(a);
  }

  // backfill a thin category only with agents carrying a real classifier signal
  // for it, so a category with few real matches stays small rather than being
  // padded with unrelated agents
  for (const k of CATEGORY_KEYS) {
    if ((counts[k] ?? 0) >= Math.max(12, perCategory / 2)) continue;
    const pool = deduped
      .filter((a) => !taken.has(a.agent_id))
      .filter((a) => (a.categoryScores?.[k] ?? 0) >= 1)
      .sort((a, b) => relevanceScore(b, k) - relevanceScore(a, k));
    for (const a of pool) {
      if ((counts[k] ?? 0) >= Math.max(12, perCategory / 2)) break;
      take({ ...a, category: k });
    }
  }

  // The list payload names which protocol an agent speaks but carries no address
  // for it, so a rebuild would otherwise write a snapshot in which every declarer
  // reads as unreachable and the shelf gate refuses the lot. Read the detail
  // record once per declarer and carry the address back, so the snapshot holds
  // what a hire can call rather than a card that only claims to be callable.
  const speaks = (a: AgentSummary) =>
    (a.supported_protocols ?? []).some((p) => p === "A2A" || p === "MCP");
  const declarers = selected.filter((a) => speaks(a) && !a.a2a_endpoint && !a.mcp_server);
  const details = await fetchDetails(chainId, declarers.map((a) => a.token_id));

  let endpointsRecovered = 0;
  for (let i = 0; i < declarers.length; i += 1) {
    const row = declarers[i];
    const detail = details[i];
    if (!detail) continue;
    // the registry's own address wins over whatever the card claims, and the
    // seeds below never overwrite it either, so a moved card still gets noticed
    if (!row.a2a_endpoint && detail.a2a_endpoint) row.a2a_endpoint = detail.a2a_endpoint;
    if (!row.mcp_server && detail.mcp_server) row.mcp_server = detail.mcp_server;
    if (!row.web_endpoint && detail.web_endpoint) row.web_endpoint = detail.web_endpoint;
    if (row.a2a_endpoint || row.mcp_server) endpointsRecovered += 1;
  }

  // The seeds are the operator's own published cards, and never overwrite an
  // endpoint the registry itself supplied, so a moved card still gets noticed.
  const seededApplied = applySeededEndpoints(selected, await loadSeededEndpoints(), chainId);

  const snapshot = {
    version: 2,
    snapshotTime: new Date().toISOString(),
    source: {
      fetched,
      upstreamTotal,
      deduped: deduped.length,
      registryTotal,
      declarers: declarers.length,
      endpointsRecovered,
      seededApplied,
    },
    counts,
    agents: selected,
  };

  const outPath = path.join(process.cwd(), "data", buildTarget.snapshotFile);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf8");

  return NextResponse.json({
    success: true,
    chainId,
    written: outPath,
    snapshot: {
      snapshotTime: snapshot.snapshotTime,
      total: selected.length,
      fetched,
      deduped: deduped.length,
      registryTotal,
      declarers: declarers.length,
      endpointsRecovered,
      seededApplied,
      counts,
    },
  });
}

interface RawLike {
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
  // the payload names the protocol an agent speaks; the address it points at is
  // absent, which is the gap the detail read below exists to recover
  supported_protocols?: string[];
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
  is_active: boolean;
  created_at: string;
}

function buildSummary(raw: RawLike): AgentSummary {
  const text = [raw.name, raw.description ?? "", (raw.supported_trust_models ?? []).join(" ")].join(" ");
  const { category, scores } = classifyAgent(text);
  return { ...raw, category, categoryScores: scores };
}