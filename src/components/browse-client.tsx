"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCard } from "./agent-card";
import { CategoryBadge } from "./category-badge";
import { CompareBar } from "./compare-bar";
import {
  CompareAgent,
  compareKey,
  readCompare,
  writeCompare,
} from "@/lib/compare-store";
import { AgentSummary, CategoryKey, CATEGORIES } from "@/lib/types";

type SortKey = "score" | "newest" | "feedback" | "health";

interface BrowseResponse {
  success: boolean;
  items: AgentSummary[];
  total: number;
  page: number;
  limit: number;
  categoryCounts: Record<string, number>;
  indexStatus: {
    totalFetched: number;
    snapshotTotal: number | null;
    lastWarmAt: number | null;
    warming: boolean;
    error: string | null;
    snapshotTime: string | null;
  };
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Top rated" },
  { key: "newest", label: "Newest" },
  { key: "feedback", label: "Most hires" },
  { key: "health", label: "Health score" },
];

export function BrowseClient({ initialCategory }: { initialCategory?: string }) {
  const [category, setCategory] = useState(initialCategory ?? "all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [items, setItems] = useState<AgentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [indexStatus, setIndexStatus] = useState<BrowseResponse["indexStatus"] | null>(null);
  const [selected, setSelected] = useState<CompareAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSelected(readCompare()), 0);
    return () => clearTimeout(t);
  }, []);

  const fetchPage = useCallback(async (pageNo: number, warm: boolean, opts: { category: string; q: string; sort: SortKey }) => {
    const params = new URLSearchParams({
      category: opts.category,
      q: opts.q,
      sort: opts.sort,
      page: String(pageNo),
      limit: "24",
    });
    if (warm) {
      params.set("warm", "1");
      params.set("warmPages", "6");
    }
    const res = await fetch(`/api/agents?${params.toString()}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    const body = (await res.json()) as BrowseResponse;
    return body;
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    const debounce = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchPage(1, true, { category, q, sort });
        if (id !== seq.current) return;
        setItems(body.items);
        setTotal(body.total);
        setPage(1);
        setCounts(body.categoryCounts);
        setIndexStatus(body.indexStatus);
      } catch (e) {
        if (id !== seq.current) return;
        setError((e as Error).message);
        setItems([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounce);
  }, [category, q, sort, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const body = await fetchPage(page + 1, false, { category, q, sort });
      setItems((prev) => [...prev, ...body.items]);
      setTotal(body.total);
      setPage(page + 1);
      setCounts(body.categoryCounts);
      setIndexStatus(body.indexStatus);
    } catch {
      setError("Could not load more agents.");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleCompare = (agent: AgentSummary) => {
    const key = compareKey(agent.chain_id, agent.token_id);
    let next: CompareAgent[];
    if (selected.some((a) => a.key === key)) {
      next = selected.filter((a) => a.key !== key);
    } else {
      next = [
        ...selected,
        {
          key,
          chainId: agent.chain_id,
          tokenId: agent.token_id,
          name: agent.name,
          image: agent.image_url,
          category: agent.category,
        },
      ];
    }
    setSelected(next);
    writeCompare(next);
  };

  const removeCompare = (key: string) => {
    const next = key === "__all__" ? [] : selected.filter((a) => a.key !== key);
    setSelected(next);
    writeCompare(next);
  };

  const filteredCategories = useMemo(() => {
    const base = [{ key: "all", label: "All agents", count: counts["all"] ?? 0 }];
    return base.concat(
      CATEGORIES.map((c) => ({
        key: c.key,
        label: c.label,
        count: counts[c.key] ?? 0,
      })),
    );
  }, [counts]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {filteredCategories.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition ${
                  active
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                    : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                }`}
              >
                {c.key !== "all" && <CategoryBadge category={c.key as CategoryKey} showLabel={false} />}
                <span>{c.label}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${
                    active ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-zinc-500"
                  }`}
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search agents, keywords, or wallet address"
              className="w-full rounded-xl border border-white/10 bg-zinc-900/60 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-amber-400/40 focus:bg-zinc-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-200 outline-none transition focus:border-amber-400/40"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {indexStatus && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${indexStatus.warming ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
            {indexStatus.warming
              ? "Indexing live BSC agents…"
              : `${indexStatus.totalFetched} agents indexed from ${indexStatus.snapshotTotal?.toLocaleString() ?? "…"} registered on BSC`}
          </span>
          <span>
            {total.toLocaleString()} matching
          </span>
          {indexStatus.snapshotTime && (
            <span>
              Snapshot {new Date(indexStatus.snapshotTime).toISOString().slice(0, 10)}
            </span>
          )}
          {indexStatus.error && (
            <span className="text-rose-400">Upstream: {indexStatus.error}</span>
          )}
        </div>
      )}

      {error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-8 text-center text-sm text-rose-300">
          Could not reach the agent index: {error}. Check that the 8004scan API is
          reachable, then reload.
        </div>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-64 rounded-2xl border border-white/8 bg-zinc-900/60 animate-shimmer" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/8 p-16 text-center">
          <p className="text-sm text-zinc-500">No agents found.</p>
          <p className="mt-1 text-xs text-zinc-600">
            The index is still warming, or no live BSC agents match this filter yet.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((agent) => {
            const key = compareKey(agent.chain_id, agent.token_id);
            const isSelected = selected.some((a) => a.key === key);
            return (
              <div key={key} className="relative">
                <button
                  onClick={() => toggleCompare(agent)}
                  title={isSelected ? "Remove from compare" : "Add to compare"}
                  className={`absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border transition ${
                    isSelected
                      ? "border-amber-400 bg-amber-400 text-zinc-950"
                      : "border-white/15 bg-zinc-950/70 text-zinc-400 opacity-0 backdrop-blur group-hover:opacity-100 hover:border-white/30 hover:text-zinc-100"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 7h16M9 12h6m-8 5h10"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <AgentCard agent={agent} />
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && items.length < total && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-6 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-zinc-100 disabled:opacity-50"
          >
            {loadingMore
              ? "Loading…"
              : `Load more (${(total - items.length).toLocaleString()} remaining)`}
          </button>
        </div>
      )}

      <CompareBar selected={selected} onRemove={removeCompare} />
    </div>
  );
}