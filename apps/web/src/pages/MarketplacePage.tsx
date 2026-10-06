import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentSummary } from '@agora/core'
import { CATEGORIES, formatNumber, formatScore, shortAddress, timeAgo } from '@agora/core'
import { CompareBar } from '../components/CompareBar'
import { Tag } from '../components/Tag'
import { getAgents } from '../lib/api'
import { chainLabel, explorerAddressUrl, registryFor, settlementAssetFor } from '../lib/contracts'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'
import { addToCart, cartKeyOf, getCart, isInCart, removeFromCart, subscribe } from '../lib/cart'
import { OPERATED_BY_LABEL, OPERATED_BY_TITLE, isOperatedByAgentSouk } from '../lib/first-party'
import { VERDICT_DOT, verdictFor } from '../lib/verdict'
import { button, cx } from '../components/ui'

const sorts = [
  {
    key: 'reachability',
    label: 'Working first',
    title: 'Agents that delivered on their last check come first, in an order that changes with each visit so every working agent is seen.',
  },
  { key: 'score', label: 'Score' },
  { key: 'newest', label: 'Newest' },
  { key: 'feedback', label: 'Most reviewed' },
  { key: 'health', label: 'Health' },
] as const

export function MarketplacePage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const category = sp.get('category') ?? 'all'
  const q = sp.get('q') ?? ''
  const sort = (sp.get('sort') ?? 'reachability') as (typeof sorts)[number]['key']
  const pcs = sp.get('pcs') === '1'
  const hide = sp.get('hide') === '1'
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const PAGE_SIZE = 48

  const [result, setResult] = useState<{
    items: AgentSummary[]
    snapshotTotal: number | null
    registryTotal: number | null
    snapshotTime: string | null
    catalogueRefreshedAt: string | null
    total: number
  } | null>(null)
  // the network is unknown until the market answers; do not paint the compiled
  // default as if it were the deployment's chain
  const [chainId, setChainId] = useState<number | null>(null)
  // the registry the shelf is read from, keyed to the chain the API says it serves
  const registry = chainId !== null ? registryFor(chainId) : null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shortlist, setShortlist] = useState<string[]>(() => getShortlist())
  const [cartKeys, setCartKeys] = useState<string[]>(() => getCart().map((c) => cartKeyOf(c.chainId, c.tokenId)))
  const [cartFull, setCartFull] = useState(false)

  useEffect(() => subscribe(() => {
    setCartKeys(getCart().map((c) => cartKeyOf(c.chainId, c.tokenId)))
    setCartFull(false)
  }), [])

  function handleToggleCart(key: string) {
    const agent = result?.items.find((a) => `${a.chain_id}/${a.token_id}` === key)
    if (!agent) return
    if (isInCart(agent.chain_id, Number(agent.token_id))) {
      removeFromCart(agent.chain_id, Number(agent.token_id))
    } else {
      const res = addToCart({
        chainId: agent.chain_id,
        tokenId: Number(agent.token_id),
        name: agent.name,
        category: agent.category ?? '',
      })
      if (res === 'full') setCartFull(true)
    }
  }

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
    getAgents({ category, q, sort, page, limit: PAGE_SIZE, pcs })
      .then((r) => {
        if (!cancelled) {
          setResult({
            items: r.items,
            snapshotTotal: r.snapshotTotal,
            registryTotal: r.registryTotal,
            snapshotTime: r.snapshotTime,
            catalogueRefreshedAt: r.indexStatus.catalogueRefreshedAt,
            total: r.total,
          })
          setChainId(r.chainId)
        }
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
  }, [category, q, sort, pcs, page])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp)
    if (key !== 'page') next.delete('page')
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setSp(next, { replace: true })
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1
  const visibleItems = result
    ? hide
      ? result.items.filter(
          (a) => a.verification?.status !== 'dead' && a.verification?.status !== 'unreachable',
        )
      : result.items
    : []

  // The catalogue's own freshness: the shared store's refresh time when it has
  // one, otherwise the committed snapshot's date, and nothing when neither.
  const freshness = useMemo(
    () =>
      catalogueFreshnessLabel(
        result?.catalogueRefreshedAt ?? null,
        result?.snapshotTime ?? null,
      ),
    [result],
  )

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Marketplace</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-8">
        <h1 className="font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
          {category === 'all' ? 'All agents' : labelFor(category)}
        </h1>
        {loading && !result ? (
          <p className="micro text-newsprint-gray">Loading agents</p>
        ) : result?.registryTotal ? (
          <p className="micro text-newsprint-gray">
            {result.registryTotal.toLocaleString('en-US')} agents registered
          </p>
        ) : null}
      </div>

      {/* the proof lives on /about, but a reviewer who lands here must still
          see the chain and asset the market actually settles in */}
      <section
        aria-label="Settlement proof"
        className="micro mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-y hairline border-slate-verdant/40 py-3 text-newsprint-gray"
      >
        {chainId === null ? (
          <span>Checking the network</span>
        ) : (
          <span>
            {chainLabel(chainId)} (chain {chainId}) · hires settle in{' '}
            {/* normal-case: the micro class uppercases, and the symbol is sUSD not SUSD */}
            <span className="normal-case">{settlementAssetFor(chainId)?.symbol ?? 'the settlement asset'}</span>
            {result ? ` · ${result.total.toLocaleString('en-US')} shown` : ''}
            {freshness ? ` · ${freshness}` : ''}
          </span>
        )}
        {chainId !== null && registry ? (
          <a
            href={explorerAddressUrl(chainId, registry)}
            target="_blank"
            rel="noreferrer"
            title={`ERC-8004 identity registry ${registry} on ${chainLabel(chainId)}`}
            className="inline-block py-2 text-press-black underline decoration-newsprint-gray underline-offset-4 transition hover:decoration-highlighter-green"
          >
            ERC-8004 registry ↗
          </a>
        ) : null}
        <Link
          to="/about"
          className="inline-block py-2 text-press-black underline decoration-press-black underline-offset-4 transition hover:decoration-highlighter-green"
        >
          Settlement proof →
        </Link>
      </section>

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
              aria-label="Show only agents that say they work with PancakeSwap"
              onClick={() => setParam('pcs', pcs ? '' : '1')}
              className={`relative h-[18px] w-[34px] rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green ${pcs ? 'bg-highlighter-green' : 'bg-slate-verdant/50'}`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-switch-knob shadow-sm transition-all duration-150 ${pcs ? 'left-[18px]' : 'left-[2px]'}`}
              />
            </button>
          </label>
          {pcs && result ? (
            <span className="micro text-newsprint-gray">
              {result.total} PancakeSwap
            </span>
          ) : null}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <span className="micro text-newsprint-gray">Hide unresponsive</span>
            <button
              type="button"
              role="switch"
              aria-checked={hide}
              aria-label="Hide unresponsive agents"
              onClick={() => setParam('hide', hide ? '' : '1')}
              className={`relative h-[18px] w-[34px] rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlighter-green ${hide ? 'bg-highlighter-green' : 'bg-slate-verdant/50'}`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-switch-knob shadow-sm transition-all duration-150 ${hide ? 'left-[18px]' : 'left-[2px]'}`}
              />
            </button>
          </label>
        </div>

        <div className="flex w-full flex-wrap items-center gap-6 sm:ml-auto sm:w-auto">
          <label className="sr-only" htmlFor="search">
            Search agents
          </label>
          <input
            id="search"
            type="search"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search name, endpoint or tag"
            className="border hairline input-hairline w-full rounded-[6px] bg-transparent sm:w-64 px-3 py-2 text-base sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
          />
          <div className="flex flex-wrap gap-1">
            {sorts.map((s) => (
              <button
                key={s.key}
                type="button"
                title={'title' in s ? s.title : undefined}
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
        {hide && result ? (
          <span className="micro text-newsprint-gray">
            {visibleItems.length} shown
          </span>
        ) : null}
      </div>

      {cartFull ? (
        <p className="micro mt-6 text-newsprint-gray">
          The cart holds 8 agents at most. Remove one to add another.
        </p>
      ) : null}

      <div className="mt-14">
        {error ? (
          <ErrorState onRetry={() => setSp(new URLSearchParams(sp))} />
        ) : loading ? (
          <GridSkeleton />
        ) : result && visibleItems.length > 0 ? (
          <AgentGrid
            items={visibleItems}
            shortlist={shortlist}
            onToggle={handleToggle}
            cartKeys={cartKeys}
            onToggleCart={handleToggleCart}
          />
        ) : (
          <EmptyState
            onReset={() => {
              setSp(new URLSearchParams(), { replace: true })
            }}
          />
        )}
      </div>

      {result && totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-10 flex items-center justify-center gap-6"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
            className="micro rounded-[5px] border hairline border-slate-verdant/40 px-4 py-2 text-press-black transition enabled:hover:border-highlighter-green disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="micro text-newsprint-gray">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setParam('page', String(page + 1))}
            className="micro rounded-[5px] border hairline border-slate-verdant/40 px-4 py-2 text-press-black transition enabled:hover:border-highlighter-green disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      ) : null}

      <CompareBar
        count={shortlist.length}
        onClear={clearShortlist}
        onCompare={() => navigate(`/compare?ids=${shortlist.join(',')}`)}
      />
    </section>
  )
}

// The catalogue's freshness in one line: the store's own refresh time as a
// relative age when it is known and real, otherwise the committed snapshot's
// date. A future or unparseable refresh time is not freshness, so it falls back
// rather than claiming a time that cannot be true.
export function catalogueFreshnessLabel(
  catalogueRefreshedAt: string | null,
  snapshotTime: string | null,
  now: number = Date.now(),
): string | null {
  const relative = catalogueRefreshedAt
    ? relativeAgeLabel(catalogueRefreshedAt, now)
    : null
  if (relative) return `catalogue refreshed ${relative}`
  if (snapshotTime) return `snapshot taken ${snapshotTime.slice(0, 10)}`
  return null
}

function relativeAgeLabel(iso: string, now: number): string | null {
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at) || at > now) return null
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'less than a minute ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function labelFor(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? 'All agents'
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
      className={`micro py-2 transition focus-visible:outline-2 focus-visible:outline-highlighter-green lg:py-0 ${
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
  cartKeys,
  onToggleCart,
}: {
  items: AgentSummary[]
  shortlist: string[]
  onToggle: (key: string) => void
  cartKeys: string[]
  onToggleCart: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((a) => (
        <AgentCard
          key={a.agent_id}
          agent={a}
          checked={shortlist.includes(`${a.chain_id}/${a.token_id}`)}
          onToggle={onToggle}
          inCart={cartKeys.includes(cartKeyOf(a.chain_id, a.token_id))}
          onToggleCart={onToggleCart}
        />
      ))}
    </div>
  )
}

function AgentCard({
  agent,
  checked,
  onToggle,
  inCart,
  onToggleCart,
}: {
  agent: AgentSummary
  checked: boolean
  onToggle: (key: string) => void
  inCart: boolean
  onToggleCart: (key: string) => void
}) {
  const img = agent.image_url ?? '/inserts/arc.svg'
  const key = `${agent.chain_id}/${agent.token_id}`
  const verdict = verdictFor(agent.chain_id, agent.verification)
  const firstParty = isOperatedByAgentSouk(agent.owner_address)
  const boosted = (agent as { boosted?: boolean }).boosted
  // indexer figures are mostly zero on a young chain, so they show only when they say something
  const score = agent.total_score > 0 ? formatScore(agent.total_score) : null
  const reviews = agent.total_feedbacks
  return (
    <article
      className={`metal relative flex flex-col rounded-[12px] border hairline bg-bone-white transition duration-150 hover:border-press-black/40 hover:shadow-[0_16px_32px_-20px_rgba(0,0,0,0.4)] motion-safe:hover:-translate-y-0.5 ${
        checked ? 'border-highlighter-green ring-1 ring-highlighter-green' : 'border-slate-verdant/35'
      }`}
    >
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        className="flex flex-1 flex-col rounded-t-[12px] p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        <div className="flex items-start gap-4">
          <img
            src={img}
            alt=""
            loading="lazy"
            className="duotone h-14 w-14 shrink-0 rounded-[12px] object-cover"
            onError={(e) => {
              // a dead image_url falls back to the house glyph once, so no card renders broken
              const el = e.currentTarget
              if (!el.dataset.fallback) {
                el.dataset.fallback = '1'
                el.src = '/inserts/arc.svg'
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="micro truncate text-newsprint-gray">{categoryName(agent.category)}</p>
            <h2 className="mt-1 truncate font-serif text-[21px] font-medium leading-tight tracking-[-0.02em] text-press-black">
              {agent.name}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-newsprint-gray">
              {firstParty ? (
                <span className="text-press-black" title={OPERATED_BY_TITLE}>
                  {OPERATED_BY_LABEL}
                </span>
              ) : (
                <>
                  by <span className="font-mono">{shortAddress(agent.owner_address)}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 text-[14px] leading-relaxed text-newsprint-gray">
          {agent.description || 'No description on-chain.'}
        </p>

        <div className="mt-auto pt-5">
          <p className="flex items-center gap-2 text-[13px]" title={verdict.explain}>
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[verdict.tone]}`} />
            <span className="font-medium text-press-black">{verdict.label}</span>
            {agent.verification ? (
              <span className="truncate text-newsprint-gray">· checked {timeAgo(agent.verification.checkedAt)}</span>
            ) : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agent.x402_supported ? <Tag title="Takes payment per call over x402">x402</Tag> : null}
            {agent.pcs ? <Tag title="Says it works with PancakeSwap">PancakeSwap</Tag> : null}
            {boosted ? <Tag title="Paid boost">Boosted</Tag> : null}
            {score ? <Tag title="8004scan total score">Score {score}</Tag> : null}
            {reviews > 0 ? (
              <Tag title="On-chain feedback entries">
                {formatNumber(reviews)} review{reviews === 1 ? '' : 's'}
              </Tag>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="flex items-center gap-2 border-t hairline border-slate-verdant/25 p-2">
        <button
          type="button"
          onClick={() => onToggle(key)}
          aria-pressed={checked}
          className={`micro inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 transition-colors focus-visible:outline-2 focus-visible:outline-press-black sm:min-h-9 ${
            checked ? 'bg-highlighter-green/20 text-press-black' : 'text-newsprint-gray hover:bg-echo-green/50 hover:text-press-black'
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
              checked ? 'border-press-black bg-press-black text-bone-white' : 'border-current'
            }`}
          >
            {checked ? (
              <svg width="9" height="7" viewBox="0 0 14 10" fill="none">
                <path d="M1 5l4 4 8-8" stroke="currentColor" strokeWidth="2.5" />
              </svg>
            ) : null}
          </span>
          Compare
          {/* the name follows the visible words, so a voice command still matches them */}
          <span className="sr-only">: {agent.name}</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleCart(key)}
          aria-pressed={inCart}
          className={`micro inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 transition-colors focus-visible:outline-2 focus-visible:outline-press-black sm:min-h-9 ${
            inCart ? 'bg-highlighter-green/20 text-press-black' : 'text-newsprint-gray hover:bg-echo-green/50 hover:text-press-black'
          }`}
        >
          <svg width="13" height="12" viewBox="0 0 16 14" fill="none" aria-hidden="true">
            <path
              d="M1 1h2l1.6 8.1a1.5 1.5 0 0 0 1.48 1.24h6.16a1.5 1.5 0 0 0 1.47-1.19L15 4H4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {inCart ? 'In cart' : 'Add to cart'}
          <span className="sr-only">: {agent.name}</span>
        </button>
      </div>
    </article>
  )
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}

function GridSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading agents"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[12px] border hairline border-slate-verdant/35 bg-bone-white"
        >
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-[12px] bg-slate-verdant/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-20 bg-slate-verdant/10" />
                <div className="h-4 w-32 bg-slate-verdant/10" />
                <div className="h-3 w-24 bg-slate-verdant/10" />
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <div className="h-3 w-full bg-slate-verdant/10" />
              <div className="h-3 w-3/4 bg-slate-verdant/10" />
            </div>
            <div className="mt-6 h-3 w-40 bg-slate-verdant/10" />
          </div>
          <div className="h-[53px] border-t hairline border-slate-verdant/25" />
        </div>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border hairline border-slate-verdant/40 px-10 py-20 text-center">
      <p className="font-serif text-[28px] font-medium">Could not reach the market.</p>
      <p className="mt-3 text-sm text-newsprint-gray">
        The catalogue service did not respond. It should be back shortly.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cx(button('primary', 'lg'), 'mt-8')}
      >
        Retry
      </button>
    </div>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="border hairline border-slate-verdant/40 px-10 py-20 text-center">
      <p className="font-serif text-[28px] font-medium">Nothing matches.</p>
      <p className="mt-3 text-sm text-newsprint-gray">
        No agent fits that filter. Clear it to see the full catalogue.
      </p>
      <button
        type="button"
        onClick={onReset}
        className={cx(button('primary', 'lg'), 'mt-8')}
      >
        Show all agents
      </button>
    </div>
  )
}