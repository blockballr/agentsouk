import { NextRequest, NextResponse } from "next/server";
import { classifyAgent } from "@/lib/categories";
import { recentChecks } from "@/lib/history-store";
import { resultsFor, type AgentResult } from "@/lib/agent-results";
import { firstPartyCategory } from "@/lib/first-party-copy";
import { loadJobsByToken } from "@/lib/durable-store";
import { indexedThrough, providerJobStats, providersOfJobs, type ProviderJobStats } from "@/lib/job-index";
import { cardCompleteness, rankPeers, searchTermsFor, type PeerCandidate } from "@/lib/peer-rank";
import { fetchAgentDetail, getAgentByToken, queryAgents, searchAgents } from "@/lib/scanner";
import { isTeamWallet } from "@/lib/team-wallets";
import type { AgentCardSkill, AgentDetail, AgentSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/compare/peers?chainId=56&tokenId=391004 - an agent and its closest
// peers from the whole ERC-8004 registry, each measured the same way. every
// figure names where it came from, and anything not read is null, never zero.
// there is no blended score: the buyer weighs the rows

interface Reach {
  ok: boolean;
  ms: number | null;
  protocol: "mcp" | "a2a" | "web" | null;
  detail: string;
}

export interface PeerRow {
  chainId: number;
  tokenId: string;
  name: string;
  image: string | null;
  owner: string;
  category: string;
  house: boolean;
  reach: Reach;
  // the marketplace's own probes of a listed agent, last 30 kept
  listedChecks: { passed: number; total: number } | null;
  card: { have: number; of: number; missing: string[] };
  price: string | null;
  work: ProviderJobStats | null;
  reputation: { score: number | null; feedbacks: number; ageDays: number | null };
  // what it has done where we can see it; null for outside agents
  results: AgentResult | null;
}

const cache = new Map<string, { at: number; body: unknown }>();
const TTL_MS = 10 * 60_000;

function candidateFrom(raw: AgentSummary): PeerCandidate {
  const { category, scores } = classifyAgent(`${raw.name} ${raw.description ?? ""}`);
  return {
    token_id: String(raw.token_id),
    chain_id: Number(raw.chain_id),
    name: raw.name ?? "",
    description: raw.description ?? null,
    owner_address: raw.owner_address ?? "",
    x402_supported: raw.x402_supported,
    total_score: raw.total_score,
    total_feedbacks: raw.total_feedbacks,
    category,
    categoryScores: scores as Record<string, number>,
  };
}

async function timed(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; ms: number } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
    await res.arrayBuffer().catch(() => null);
    return { status: res.status, ms: Date.now() - start };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// one call now: an MCP initialize, else the A2A card, else the web endpoint.
// a 402 counts as answering, since it is a paid endpoint asking to be paid
async function probe(d: Partial<AgentDetail>): Promise<Reach> {
  const target = d.mcp_server
    ? { url: d.mcp_server, protocol: "mcp" as const }
    : d.a2a_endpoint
      ? { url: d.a2a_endpoint, protocol: "a2a" as const }
      : d.web_endpoint
        ? { url: d.web_endpoint, protocol: "web" as const }
        : null;
  if (!target || !/^https:\/\//i.test(target.url)) {
    return { ok: false, ms: null, protocol: null, detail: "publishes no public endpoint" };
  }
  const init: RequestInit =
    target.protocol === "mcp"
      ? {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-souk-compare", version: "1" } },
          }),
        }
      : { headers: { accept: "application/json" } };
  const r = await timed(target.url, init, 6000);
  if (!r) return { ok: false, ms: null, protocol: target.protocol, detail: "no answer within 6 seconds" };
  const ok = r.status < 400 || r.status === 402;
  return { ok, ms: r.ms, protocol: target.protocol, detail: ok ? `answered ${r.status}` : `answered ${r.status}` };
}

function declaredPrice(skills: AgentCardSkill[] | undefined): string | null {
  for (const s of skills ?? []) {
    const p = (s as { price?: unknown }).price;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  return null;
}

async function measure(chainId: number, tokenId: string, known: Partial<AgentDetail> | null, checks: Map<string, { status: string }[]>): Promise<PeerRow | null> {
  const d = (known ?? (await fetchAgentDetail(chainId, tokenId, 6000).catch(() => null))) as Partial<AgentDetail> | null;
  if (!d) return null;
  // a seller can quote from a wallet other than its listed one, so the providers
  // on jobs the marketplace recorded for this agent count as its wallets too
  const recorded = await loadJobsByToken(chainId, tokenId).catch(() => []);
  const quotedFrom = await providersOfJobs(chainId, recorded.map((j) => Number(j.onchainJobId))).catch(() => []);
  const wallets = [d.agent_wallet, d.owner_address, ...quotedFrom].filter((w): w is string => typeof w === "string" && w.length === 42);
  const [reach, work, results] = await Promise.all([
    probe(d),
    providerJobStats(chainId, wallets).catch(() => null),
    resultsFor(chainId, tokenId, d.agent_wallet ?? null).catch(() => null),
  ]);
  const history = checks.get(tokenId) ?? [];
  const created = d.created_at ? Date.parse(d.created_at) : NaN;
  const category = (d as { category?: string }).category ?? classifyAgent(`${d.name ?? ""} ${d.description ?? ""}`).category;
  return {
    chainId,
    tokenId,
    name: d.name ?? `#${tokenId}`,
    image: d.image_url ?? null,
    owner: d.owner_address ?? "",
    category,
    house: isTeamWallet(d.owner_address),
    reach,
    listedChecks: history.length
      ? { passed: history.filter((c) => c.status === "online" || c.status === "delivered").length, total: history.length }
      : null,
    card: cardCompleteness(d),
    price: declaredPrice(d.skills),
    work,
    reputation: {
      score: typeof d.total_score === "number" && d.total_score > 0 ? d.total_score : null,
      feedbacks: d.total_feedbacks ?? 0,
      ageDays: Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null,
    },
    results,
  };
}

export async function GET(req: NextRequest) {
  const chainId = Number(req.nextUrl.searchParams.get("chainId") ?? 56);
  const tokenId = req.nextUrl.searchParams.get("tokenId") ?? "";
  if (!/^\d+$/.test(tokenId)) return NextResponse.json({ success: false, error: "tokenId is required" }, { status: 400 });
  const key = `${chainId}:${tokenId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  const subject = (await getAgentByToken(chainId, tokenId)) as AgentDetail | null;
  if (!subject) return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  const subjectCandidate = candidateFrom(subject as unknown as AgentSummary);
  // the shelf files every listing under a tab, and that beats a re-read of its
  // text, which misses a description that never names its category
  const shelved = (await queryAgents({ limit: 5000, includeHouse: true, includeDelisted: true }).catch(() => ({ items: [] as AgentSummary[] }))).items.find(
    (a) => String(a.token_id) === tokenId,
  );
  const listedCategory = firstPartyCategory(chainId, tokenId) ?? shelved?.category ?? (subject as { category?: string }).category;
  if (listedCategory && listedCategory !== "general") subjectCandidate.category = listedCategory;

  const terms = searchTermsFor(subjectCandidate.category === "general" ? undefined : subjectCandidate.category, subject.name ?? "");
  const results = await Promise.all(terms.map((t) => searchAgents(t, 100, chainId).catch(() => ({ data: [] as unknown[] }))));
  const candidates = results.flatMap((r) => (r.data as AgentSummary[]).map(candidateFrom));
  const peers = rankPeers(subjectCandidate, candidates, 5);

  const ids = [tokenId, ...peers.map((p) => p.token_id)];
  const checks = (await recentChecks(ids, 30).catch(() => new Map())) as Map<string, { status: string }[]>;
  const rows = await Promise.all([
    measure(chainId, tokenId, subject, checks),
    ...peers.map((p) => measure(chainId, p.token_id, null, checks)),
  ]);

  const body = {
    success: true,
    chainId,
    readAt: new Date().toISOString(),
    jobsIndexedThrough: await indexedThrough(chainId).catch(() => 0),
    searchedFor: terms,
    agents: rows.filter((r): r is PeerRow => r !== null),
  };
  cache.set(key, { at: Date.now(), body });
  return NextResponse.json(body);
}
