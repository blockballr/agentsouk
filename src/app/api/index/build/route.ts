import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchAgentsPage, searchAgents } from "@/lib/scanner";
import { classifyAgent, relevanceScore } from "@/lib/categories";
import { AgentSummary, CATEGORY_KEYS, CategoryKey } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST /api/index/build?per=40&secret=...
// writes a balanced snapshot of real, live ERC-8004 agents on BSC to
// data/agents.json
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

export async function POST(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const secret = sp.get("secret") ?? process.env.INDEX_SECRET ?? "dev";
  if (secret !== (process.env.INDEX_SECRET ?? "dev")) {
    return NextResponse.json({ success: false, error: "bad secret" }, { status: 401 });
  }

  const perCategory = Math.min(60, Math.max(5, Number(sp.get("per") ?? 40) || 40));

  const jobs: { label: string; run: () => Promise<{ data: RawLike[]; total?: number | null }> }[] = [];

  for (const key of CATEGORY_KEYS) {
    for (const term of CATEGORY_TERMS[key]) {
      jobs.push({
        label: `search:${key}:${term}`,
        run: async () => {
          const r = await searchAgents(term, 100);
          return { data: r.data as RawLike[], total: r.total };
        },
      });
    }
  }
  for (let p = 1; p <= GENERAL_PAGES; p++) {
    jobs.push({
      label: `pages:${p}`,
      run: async () => {
        const r = await fetchAgentsPage(p);
        return { data: r.data as RawLike[], total: r.meta.pagination.total };
      },
    });
  }

  const results = await fetchInBatches(jobs);

  const byId = new Map<string, AgentSummary>();
  let fetched = 0;
  let upstreamTotal: number | null = null;

  for (const { data, total } of results) {
    if (total) upstreamTotal = total;
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

  const snapshot = {
    version: 2,
    snapshotTime: new Date().toISOString(),
    source: { fetched, upstreamTotal, deduped: deduped.length },
    counts,
    agents: selected,
  };

  const outPath = path.join(process.cwd(), "data", "agents.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf8");

  return NextResponse.json({
    success: true,
    written: outPath,
    snapshot: {
      snapshotTime: snapshot.snapshotTime,
      total: selected.length,
      fetched,
      deduped: deduped.length,
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
  is_active: boolean;
  created_at: string;
}

function buildSummary(raw: RawLike): AgentSummary {
  const text = [raw.name, raw.description ?? "", (raw.supported_trust_models ?? []).join(" ")].join(" ");
  const { category, scores } = classifyAgent(text);
  return { ...raw, category, categoryScores: scores };
}