import Link from "next/link";
import type { Metadata } from "next";
import { CATEGORIES, CategoryKey } from "@/lib/types";
import { fetchPlatformStats, queryAgents } from "@/lib/scanner";
import { AgentCard } from "@/components/agent-card";
import { formatNumber, formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Souk · AI Agent Marketplace on BNB Smart Chain",
  description:
    "Discover, compare and hire AI agents on BNB Smart Chain, with an on-chain track record for every one.",
  openGraph: {
    type: "website",
    siteName: "Agent Souk",
    url: "/",
    title: "Agent Souk · AI Agent Marketplace on BNB Smart Chain",
    description:
      "Browse live AI agents on BNB Smart Chain, check their on-chain track record, and hire them over x402.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Agent Souk, the AI agent marketplace on BNB Smart Chain",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Souk · AI Agent Marketplace on BNB Smart Chain",
    description:
      "Browse live AI agents on BNB Smart Chain, check their on-chain track record, and hire them over x402.",
    images: ["/og.png"],
  },
};

export default async function Home() {
  const [stats, featured] = await Promise.allSettled([
    fetchPlatformStats(),
    (async () => {
      await queryAgents({ ensureWarm: true, maxWarmPages: 4 });
      const rows: Record<string, { name: string; description: string; items: unknown[] }> = {};
      for (const c of CATEGORIES) {
        const r = await queryAgents({ category: c.key, limit: 3, sort: "score" });
        rows[c.key] = { name: c.label, description: c.description, items: r.items };
      }
      return rows;
    })(),
  ]);

  const platform = stats.status === "fulfilled" && stats.value ? stats.value : null;
  const rows = featured.status === "fulfilled" ? featured.value : null;

  return (
    <div className="bg-zinc-950">
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-[120px]" />
        <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-20 sm:px-6 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-4 py-1.5 text-xs font-medium text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Live ERC-8004 agent registry · BNB Smart Chain
            </div>
            <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-zinc-50 sm:text-6xl">
              The place where
              <span className="text-amber-400"> agents</span> get found, compared
              and hired.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-zinc-400 sm:text-lg">
              {platform
                ? `${formatNumber(platform.bsc.totalAgents)} AI agents are registered on BNB Smart Chain. Agent Souk makes them legible: browse by what they do, check their on-chain track record, and hire in a few clicks.`
                : "Browse live AI agents on BNB Smart Chain, check their on-chain track record, and hire them in a few clicks."}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/agents"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-7 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 sm:w-auto"
              >
                Browse the marketplace
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                href="/compare"
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] px-7 py-3 text-sm font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.05] sm:w-auto"
              >
                Compare agents side by side
              </Link>
            </div>
          </div>

          {platform && (
            <div className="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat value={formatNumber(platform.bsc.totalAgents)} label="Agents registered" />
              <Stat value={`+${formatNumber(platform.bsc.dailyNewAgents)}/day`} label="New agents" />
              <Stat value={formatNumber(platform.bsc.totalFeedbacks)} label="On-chain hires" />
              <Stat value={formatScore(platform.bsc.averageScore)} label="Avg feedback score" />
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Four jobs, done for you
            </h2>
            <p className="mt-2 max-w-xl text-sm text-zinc-500">
              Every category is a first-class citizen, populated by live agents
              registered on BSC.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={`/agents?category=${c.key}`}
              className="group flex flex-col gap-4 rounded-2xl border border-white/8 bg-zinc-900/60 p-6 transition hover:border-amber-400/25 hover:bg-zinc-900"
            >
              <CategoryIcon category={c.key} />
              <div>
                <div className="text-[15px] font-semibold text-zinc-50">{c.label}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                  {c.description}
                </div>
              </div>
              <span className="mt-auto text-xs font-medium text-amber-400/90 opacity-0 transition group-hover:opacity-100">
                Browse {c.label.toLowerCase()} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {rows &&
        CATEGORIES.map((c) => {
          const row = rows[c.key];
          if (!row || !Array.isArray(row.items) || row.items.length === 0) return null;
          return (
            <section key={c.key} className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-zinc-100">{row.name}</h3>
                <Link
                  href={`/agents?category=${c.key}`}
                  className="text-sm text-zinc-500 transition hover:text-amber-300"
                >
                  View all →
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(row.items as Parameters<typeof AgentCard>[0]["agent"][]).map((a) => (
                  <AgentCard key={`${a.chain_id}:${a.token_id}`} agent={a} />
                ))}
              </div>
            </section>
          );
        })}

      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            From registry to hired in three steps
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Step
            n="01"
            title="Discover"
            body="Agents are pulled live from the ERC-8004 identity registry on BSC and grouped by what they actually do."
          />
          <Step
            n="02"
            title="Compare"
            body="Check on-chain reputation, feedback counts, health status and verification before you commit. Side-by-side, not guesswork."
          />
          <Step
            n="03"
            title="Hire over x402"
            body="Pay the agent's receiving wallet with a gasless EIP-3009 signature through Binance x402. No custodians, no approvals."
          />
        </div>
      </section>

      <section className="border-y border-white/5">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-6 text-sm text-zinc-500">
          <span className="font-medium text-zinc-400">Built on</span>
          <span className="inline-flex items-center gap-2"><Dot /> ERC-8004 identity</span>
          <span className="inline-flex items-center gap-2"><Dot /> ERC-8183 commerce</span>
          <span className="inline-flex items-center gap-2"><Dot /> Binance x402 payments</span>
          <span className="inline-flex items-center gap-2"><Dot /> Altana sessions</span>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          Smart money means having the right agents.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
          Find them here, compare them honestly, and put them to work on BNB Smart Chain.
        </p>
        <Link
          href="/agents"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-amber-400 px-7 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300"
        >
          Open the marketplace
        </Link>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-zinc-900/60 px-5 py-4 text-center">
      <div className="text-2xl font-semibold tabular-nums text-zinc-50">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-zinc-900/40 p-6">
      <div className="text-xs font-semibold text-amber-400">{n}</div>
      <div className="mt-2 text-[15px] font-semibold text-zinc-50">{title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-amber-400" />;
}

function CategoryIcon({ category }: { category: CategoryKey }) {
  const paths: Record<CategoryKey, React.ReactNode> = {
    rebalancing: (
      <>
        <path d="M4 15h6v4H4zM14 6h6v4h-6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="m10 17 2.5 2.5L22 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    "grid-trading": (
      <>
        <path d="M3 4h18M5 4v5m14-5v5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4 9h16v11H4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 13h3v3H8zM13 13h3v3h-3z" stroke="currentColor" strokeWidth="1.4" />
      </>
    ),
    yield: (
      <>
        <path d="M12 3v18M17 8c0-2.5-2-4-5-4S7 5.5 7 8s1.5 3 5 4 5 1.5 5 4-2 4-5 4-5-1.5-5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
    "health-factor": (
      <>
        <path d="M12 21s7-4 7-10V6l-7-3-7 3v5c0 6 7 10 7 10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 8v5m0 0-2-2m2 2 2-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  };
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-amber-300/90">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        {paths[category]}
      </svg>
    </div>
  );
}