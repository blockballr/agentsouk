import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentSummary } from '@agora/core'
import { CATEGORIES, formatNumber, formatScore, shortAddress } from '@agora/core'
import { CompareBar } from '../components/CompareBar'
import { getAgents } from '../lib/api'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'

const sorts = [
  { key: 'score', label: 'Score' },
  { key: 'newest', label: 'Newest' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'health', label: 'Health' },
] as const

export function MarketplacePage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const category = sp.get('category') ?? 'all'
  const q = sp.get('q') ?? ''
  const sort = (sp.get('sort') ?? 'score') as (typeof sorts)[number]['key']
  const pcs = sp.get('pcs') === '1'

  const [result, setResult] = useState<{ items: AgentSummary[]; snapshotTotal: number | null; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shortlist, setShortlist] = useState<string[]>(() => getShortlist())

  function handleToggle(key: string) {
    setShortlist(toggleShortlist(key))
  }

  function clearShortlist() {
    setShortlist([])
    persistShortlist([])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAgents({ category, q, sort, limit: 48, pcs })
      .then((r) => {
        if (!cancelled) setResult({ items: r.items, snapshotTotal: r.snapshotTotal, total: r.total })
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category, q, sort, pcs])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setSp(next, { replace: true })
  }

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Marketplace</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-8">
        <h1 className="font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
          {category === 'all' ? 'All agents' : labelFor(category)}
        </h1>
        {result?.snapshotTotal ? (
          <p className="micro text-newsprint-gray">
            {result.snapshotTotal.toLocaleString('en-US')} agents registered
          </p>
        ) : null}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-6">
        <div className="flex flex-wrap gap-6">
          <FilterChip
            active={category === 'all'}
            onClick={() => setParam('category', 'all')}
          >
            All
          </FilterChip>
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.key}
              active={category === c.key}
              onClick={() => setParam('category', c.key)}
            >
              {c.label}
            </FilterChip>
          ))}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <span className="micro text-newsprint-gray">PancakeSwap</span>
            <button
              type="button"
              role="switch"
              aria-checked={pcs}
              aria-label="Filter PancakeSwap-native agents"
              onClick={() => setParam('pcs', pcs ? '' : '1')}
              className={`relative h-[18px] w-[34px] rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green ${pcs ? 'bg-highlighter-green' : 'bg-slate-verdant/30'}`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-bone-white shadow-sm transition-all duration-150 ${pcs ? 'left-[18px]' : 'left-[2px]'}`}
              />
            </button>
          </label>
          {pcs && result ? (
            <span className="micro text-newsprint-gray">
              {result.total} PancakeSwap-native
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-6">
          <label className="micro text-newsprint-gray" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            type="search"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Name, endpoint, tag"
            className="hairline w-56 border-slate-verdant/25 bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
          />
          <div className="flex gap-1">
            {sorts.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setParam('sort', s.key)}
                className={`micro rounded-[5px] px-3 py-2 transition focus-visible:outline-2 focus-visible:outline-highlighter-green ${
                  sort === s.key
                    ? 'bg-highlighter-green/20 text-press-black'
                    : 'text-newsprint-gray hover:text-press-black'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-14">
        {error ? (
          <ErrorState onRetry={() => setSp(new URLSearchParams(sp))} />
        ) : loading ? (
          <GridSkeleton />
        ) : result && result.items.length > 0 ? (
          <AgentGrid
            items={result.items}
            shortlist={shortlist}
            onToggle={handleToggle}
          />
        ) : (
          <EmptyState
            onReset={() => {
              setSp(new URLSearchParams(), { replace: true })
            }}
          />
        )}
      </div>

      <CompareBar
        count={shortlist.length}
        onClear={clearShortlist}
        onCompare={() => navigate(`/compare?ids=${shortlist.join(',')}`)}
      />
    </section>
  )
}

function labelFor(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? 'All agents'
}

const verificationTone: Record<string, string> = {
  delivered: 'border-highlighter-green/40 text-highlighter-green',
  gated: 'border-slate-verdant/40 text-slate-verdant',
  dead: 'border-slate-verdant/25 text-newsprint-gray',
  unreachable: 'border-slate-verdant/25 text-newsprint-gray',
}

function verificationLabel(status: string): string {
  return status === 'delivered' ? 'verified delivered' : status
}

function VerificationBadge({
  status,
  checkedAt,
  quality,
}: {
  status: string
  checkedAt: string
  quality?: { grade: 'good' | 'partial' | 'poor'; reason: string; model: string }
}) {
  const title =
    quality
      ? `AI review: ${quality.grade} - ${quality.reason} (checked ${checkedAt.slice(0, 10)})`
      : `Shopper checked ${checkedAt}`
  return (
    <BadgeCell tone={verificationTone[status] ?? verificationTone.dead} title={title}>
      {verificationLabel(status)}
    </BadgeCell>
  )
}

function BadgeCell({
  tone,
  title,
  children,
}: {
  tone?: string
  title?: string
  children?: ReactNode
}) {
  return (
    <span
      title={title}
      className={`micro flex h-[26px] min-w-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full px-2 ${
        tone !== undefined ? `border hairline ${tone}` : ''
      }`}
    >
      {children}
    </span>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`micro transition focus-visible:outline-2 focus-visible:outline-highlighter-green ${
        active
          ? 'text-press-black underline decoration-highlighter-green decoration-2 underline-offset-8'
          : 'text-newsprint-gray hover:text-press-black'
      }`}
    >
      {children}
    </button>
  )
}

function AgentGrid({
  items,
  shortlist,
  onToggle,
}: {
  items: AgentSummary[]
  shortlist: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 bg-bone-white pl-px pt-px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((a) => (
        <AgentCard
          key={a.agent_id}
          agent={a}
          checked={shortlist.includes(`${a.chain_id}/${a.token_id}`)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function AgentCard({
  agent,
  checked,
  onToggle,
}: {
  agent: AgentSummary
  checked: boolean
  onToggle: (key: string) => void
}) {
  const img = agent.image_url ?? '/inserts/arc.svg'
  const key = `${agent.chain_id}/${agent.token_id}`
  return (
    <div className="relative -ml-px -mt-px border hairline border-slate-verdant/20 bg-bone-white">
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        className="group flex h-full flex-col p-6 transition-colors duration-150 hover:bg-echo-green/40 focus-visible:outline-2 focus-visible:outline-press-black"
      >
        <div className="flex items-center justify-between gap-3 pr-7">
          <div className="flex min-w-0 items-center gap-4">
            <img
              src={img}
              alt={agent.name}
              loading="lazy"
              className="duotone h-16 w-16 shrink-0 rounded-[14px] object-cover"
            />
            <div className="min-w-0">
              <span className="micro text-muted-sage">
                {agent.category === 'general' ? 'General' : (agent.category ?? '')}
              </span>
              <h2 className="mt-1 truncate font-serif text-[22px] font-medium leading-tight tracking-[-0.02em]">
                {agent.name}
              </h2>
              <p className="mt-1 font-mono text-[11px] text-newsprint-gray">
                {shortAddress(agent.owner_address)}
              </p>
            </div>
          </div>
          <div className="flex h-[26px] shrink-0 items-center">
            {agent.x402_supported && (
              <span className="micro inline-flex items-center gap-2 rounded-full border hairline border-highlighter-green/40 px-2 py-1 text-highlighter-green">
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:absolute motion-safe:inline-flex motion-safe:h-full motion-safe:w-full motion-safe:animate-ping motion-safe:rounded-full motion-safe:bg-highlighter-green opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-highlighter-green" />
                </span>
                x402
              </span>
            )}
          </div>
        </div>

        <p className="mt-5 line-clamp-2 text-sm leading-relaxed text-newsprint-gray">
          {agent.description || 'No description registered on-chain.'}
        </p>

        <dl className="mt-8 w-full rounded-lg border border-[#2bee4b]/50 bg-[#a7f8b4] px-4 py-3.5">
          <div className="flex items-start justify-center gap-x-10">
            <Stat label="Score" value={formatScore(agent.total_score)} />
            <Stat label="Health" value={agent.health_score !== null ? formatScore(agent.health_score) : '—'} />
            <Stat label="Hires" value={formatNumber(agent.total_feedbacks)} />
          </div>
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {agent.verification ? (
            <VerificationBadge
              status={agent.verification.status}
              checkedAt={agent.verification.checkedAt}
              quality={agent.verification.quality}
            />
          ) : (
            <BadgeCell />
          )}
          {agent.pcs ? (
            <BadgeCell
              tone="border-slate-verdant/25 text-newsprint-gray"
              title="PancakeSwap-native agent"
            >
              PCS
            </BadgeCell>
          ) : (
            <BadgeCell />
          )}
          <BadgeCell />
          <BadgeCell />
        </div>

        <span className="micro mt-auto pt-6 text-newsprint-gray transition group-hover:text-press-black">
          View agent →
        </span>
      </Link>

      <label
        className={`absolute right-3 top-3 z-10 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-full border hairline transition-colors duration-150 focus-within:outline-2 focus-within:outline-highlighter-green ${
          checked
            ? 'border-highlighter-green bg-highlighter-green'
            : 'border-slate-verdant/30 bg-bone-white/90 hover:border-highlighter-green'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(key)}
          aria-label={`Compare ${agent.name}`}
          title="Shortlist for comparison"
          className="h-3 w-3 accent-highlighter-green opacity-0"
        />
        {checked && (
          <svg
            width="10"
            height="8"
            viewBox="0 0 14 10"
            fill="none"
            aria-hidden="true"
            className="pointer-events-none absolute text-typesetter-ink"
          >
            <path
              d="M1 5l4 4 8-8"
              stroke="currentColor"
              strokeWidth="2.5"
            />
          </svg>
        )}
      </label>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <dt className="micro text-newsprint-gray">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-press-black">
        {value}
      </dd>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading agents"
      className="grid grid-cols-1 bg-bone-white pl-px pt-px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="-ml-px -mt-px animate-pulse border hairline border-slate-verdant/20 bg-bone-white p-6"
        >
          <div className="flex items-center justify-between gap-3 pr-7">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-[14px] bg-slate-verdant/10" />
              <div className="space-y-2">
                <div className="h-3 w-20 bg-slate-verdant/10" />
                <div className="h-4 w-28 bg-slate-verdant/10" />
                <div className="h-3 w-20 bg-slate-verdant/10" />
              </div>
            </div>
            <div className="h-[26px]" />
          </div>
          <div className="mt-6 space-y-2">
            <div className="h-3 w-full bg-slate-verdant/10" />
            <div className="h-3 w-3/4 bg-slate-verdant/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border hairline border-slate-verdant/20 px-10 py-20 text-center">
      <p className="font-serif text-[28px] font-medium">Could not reach the market.</p>
      <p className="mt-3 text-sm text-newsprint-gray">
        The catalogue service did not respond. It should be back shortly.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="micro mt-8 rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        Retry
      </button>
    </div>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="border hairline border-slate-verdant/20 px-10 py-20 text-center">
      <p className="font-serif text-[28px] font-medium">Nothing matches.</p>
      <p className="mt-3 text-sm text-newsprint-gray">
        No agent fits that filter. Clear it to see the full catalogue.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="micro mt-8 rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        Show all agents
      </button>
    </div>
  )
}