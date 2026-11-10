import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentSummary } from '../core/types'
import { defaultAvatarFor } from '../lib/default-avatar'
import { CATEGORIES, formatNumber, formatScore, sellsByJob, takesJobs, takesVault, shortAddress, timeAgo, classifyExecution } from '@agora/core'
import { CompareBar } from '../components/CompareBar'
import { AgentGalleryCard } from '../components/AgentGalleryCard'
import { OnChainBadge } from '../components/OnChainBadge'
import { getAgents, prefetchAgent } from '../lib/api'
import { chainLabel, explorerAddressUrl, registryFor, settlementAssetFor } from '../lib/contracts'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'

import { OPERATED_BY_LABEL, isOperatedByAgentSouk } from '../lib/first-party'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { Section, Stack, Row, Txt, Dot, Rule, Btn, type DotTone } from '../components/souk'

// The sorts are the four metrics a buyer picks from; reachability is not one of
// them because it is not a choice. It settles the ties underneath every metric,
// so an agent that answered its last probe outranks one never checked, and job
// capability leads all of it. Picking a metric names what leads the chain, not
// what replaces that order.
const jobSorts = [
  { key: 'vault', label: 'VAULT' },
  { key: 'jobs', label: 'ESCROW' },
  { key: 'direct', label: 'DIRECT' },
] as const

const defaultSorts = [
  {
    key: 'score',
    label: 'Reputation',
    title: 'Registry reputation leads, then most reviewed, then health, then newest. Reachability only settles what those cannot, and job sellers lead each group.',
  },
  { key: 'feedback', label: 'Most reviewed' },
  { key: 'health', label: 'Health' },
  { key: 'newest', label: 'Newest' },
] as const

// the verdict's four tones in the design's five-state dot grammar
const VERDICT_TONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

// the states a listing can be in, in the order they cost a buyer
const LEGEND: { tone: DotTone; label: string }[] = [
  { tone: 'verified', label: 'Verified' },
  { tone: 'online-fixed', label: 'Online' },
  { tone: 'held', label: 'Restricted' },
  { tone: 'bad', label: 'Unreachable' },
  { tone: 'bad', label: 'Unresponsive' },
  { tone: 'quiet', label: 'Not checked yet' },
]

export function MarketplacePage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()

  // persist the marketplace filters so they survive a trip to an agent's detail
  // page and back: the in-app "back to agents" links drop the query string, and
  // a fresh mount should reopen on the sort the buyer actually picked
  useEffect(() => {
    const stored = sessionStorage.getItem('marketplace:params')
    if (stored && !sp.toString()) {
      setSp(new URLSearchParams(stored), { replace: true })
    }
  }, [])
  useEffect(() => {
    sessionStorage.setItem('marketplace:params', sp.toString())
  }, [sp])
  const category = sp.get('category') ?? 'all'
  const q = sp.get('q') ?? ''
  // the sector filter rides the same url as its platform shelf
  const sector = sp.get('sector') ?? ''
  // no sort named reads as score, the chain's first metric; reachability is not
  // a choice here, it settles the ties underneath whichever metric is picked,
  // and job capability leads every one of them
  // the shelf opens on all listings. Vault, job and call are the three rails; a
  // vault is ours or a self-run one, a job is open to any seller who can quote,
  // and a call to any callable endpoint.
  const type = (sp.get('type') ?? 'all') as 'all' | 'direct' | 'jobs' | 'x402' | 'vault'
  const metric = (sp.get('metric') ?? 'score') as 'score' | 'newest' | 'feedback' | 'health'
  const pcs = sp.get('pcs') === '1'
  // first-party agents, the same owner fact the cards disclose
  const owned = sp.get('owned') === '1'
  const hide = sp.get('hide') === '1'
  const verifiedOnly = sp.get('verified') === '1'
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const PAGE_SIZE = 12

  const [result, setResult] = useState<{
    items: AgentSummary[]
    snapshotTotal: number | null
    shelved: number | null
    registryTotal: number | null
    snapshotTime: string | null
    catalogueRefreshedAt: string | null
    source: 'store' | 'snapshot' | 'unavailable'
    counts: Record<string, number>
    onlineCounts: Record<string, number>
    justListed: AgentSummary[]
    featured: AgentSummary[]
    // the joined sector list, only present when the server's summary carries it
    sectors: string[]
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
  const [showFilters, setShowFilters] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

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
    getAgents({ category, q, sector: sector || undefined, owned, type, metric, page, limit: PAGE_SIZE, pcs })
      .then((r) => {
        if (!cancelled) {
          setResult({
            items: r.items,
            snapshotTotal: r.snapshotTotal,
            shelved: r.shelved,
            registryTotal: r.registryTotal,
            snapshotTime: r.snapshotTime,
            catalogueRefreshedAt: r.indexStatus.catalogueRefreshedAt,
            source: r.indexStatus.catalogueSource,
            counts: r.counts,
            onlineCounts: r.onlineCounts,
            justListed: r.justListed,
            featured: r.featured,
            sectors: r.sectors,
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
  }, [category, q, sector, owned, type, metric, pcs, page])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp)
    if (key !== 'page') next.delete('page')
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setSp(next, { replace: true })
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1
  const visibleItems = result
    ? result.items.filter((a) => {
        if (hide && (a.verification?.status === 'dead' || a.verification?.status === 'unreachable')) return false
        if (verifiedOnly) {
          const v = verdictFor(a.chain_id ?? 0, a.verification)
          if (v.label !== 'Verified') return false
        }
        return true
      })
    : []

  // The catalogue's own freshness: the shared store's refresh time when it has
  // one, and nothing when it does not. The committed snapshot's date is not
  // shown, so a stale build cannot read as a fresh shelf.
  const freshness = useMemo(
    () => catalogueFreshnessLabel(result?.catalogueRefreshedAt ?? null),
    [result],
  )

  // the shelf's strap: chain and registry size only; the hireable count and the
  // freshness move into the live stamp chip so the two facts read as state
  const strap = [
    'shelf',
    chainId === null ? 'checking the network' : `${chainLabel(chainId)} ${chainId}`,
    result?.registryTotal ? `${result.registryTotal.toLocaleString('en-US')} agents` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-8 pb-[240px] xl:pb-16">
        {/* the shelf bar: the facts a buyer checks before scrolling, directly
            under the nav. no panel, no hover copy. */}
        <div className="-mx-8 mb-6 border-b border-souk-hair px-8 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Txt size={10} lead={14} mono upper tone="data">{strap}</Txt>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${result ? 'bg-souk-good animate-scale-pulse' : 'bg-souk-muted'}`}
              />
              {result ? `${result.total.toLocaleString('en-US')} hireable · ${freshness}` : 'reading the shelf'}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {['ERC-8004', 'ERC-8183', 'x402', 'PancakeSwap'].map((rail) => (
                <span key={rail} className="rounded-[6px] border border-souk-hair px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-muted">
                  {rail}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            {chainId !== null ? (
              <Txt size={11} lead={16} mono tone="steel">
                hires settle in {settlementAssetFor(chainId)?.symbol ?? 'the settlement asset'}
                {result ? ` · ${result.total.toLocaleString('en-US')} shown` : ''}
              </Txt>
            ) : null}
            {chainId !== null && registry ? (
              <a
                href={explorerAddressUrl(chainId, registry)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] leading-4 text-souk-sky transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
              >
                ERC-8004 registry ↗
              </a>
            ) : null}
          </div>
        </div>

        <Section pad="pt-2 pb-6">
          <AgentGalleryCard />
        </Section>

        {/* the control band: two rows, sticky. categories first, then find, rail,
            order and the count together; the toggles and the state key fold away
            until asked for, so the shelf is not four rows of chrome before a card */}
        <Section pad="py-0">
        <div className="sticky top-0 z-20 -mx-8 border-y border-souk-hair bg-souk-canvas/90 px-8 backdrop-blur-[14px]">
          <Row align="center" gap={16} className="flex-wrap border-b border-souk-hair py-3">
            <div className="-mx-1 flex min-w-0 basis-full items-center gap-6 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:basis-auto sm:flex-1">
              <Tab active={category === 'all'} onClick={() => setParam('category', 'all')}>
                All
                {result ? (
                  <span className="ml-1.5 font-mono text-[10px] text-souk-muted" title={`${result.onlineCounts.all ?? 0} online of ${result.counts.all ?? 0}`}>
                    {result.onlineCounts.all ?? 0}
                  </span>
                ) : null}
              </Tab>
              {CATEGORIES.map((c) => (
                <Tab key={c.key} active={category === c.key} onClick={() => setParam('category', c.key)}>
                  {c.label}
                  {result ? (
                    <span className="ml-1.5 font-mono text-[10px] text-souk-muted" title={`${result.onlineCounts[c.key] ?? 0} online of ${result.counts[c.key] ?? 0}`}>
                      {result.onlineCounts[c.key] ?? 0}
                    </span>
                  ) : null}
                </Tab>
              ))}
            </div>
            <Row align="center" gap={16} className="w-full justify-end sm:w-auto">
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                className="inline-flex min-h-[32px] cursor-pointer items-center rounded-[6px] border border-souk-hair px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-slate transition hover:text-souk-ink"
              >
                Filters{pcs || owned || hide || verifiedOnly || sector === 'stocks' ? ' ·' : ''}
              </button>
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                aria-expanded={showLegend}
                title="The five states, in the order they cost you"
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-[6px] border border-souk-hair font-mono text-[10px] text-souk-muted transition hover:text-souk-ink"
              >
                ?
              </button>
            </Row>
          </Row>

          <Row align="center" gap={12} className="flex-wrap py-3">
            <label className="flex h-10 w-full min-w-0 basis-full items-center gap-2 rounded-[6px] border border-souk-hair bg-souk-surface1 px-3 sm:w-auto sm:max-w-[320px] sm:flex-1">
              <span className="sr-only">Search agents</span>
              <input
                id="search"
                type="search"
                value={q}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search agents, skills, endpoints"
                className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
              />
            </label>
            <Row align="center" gap={4} className="hidden sm:flex">
              {jobSorts.map((s) => (
                <SortButton
                  key={s.key}
                  active={type === s.key}
                  onClick={() => setParam('type', s.key)}
                >
                  {s.label}
                </SortButton>
              ))}
            </Row>
            <select
              aria-label="Hire type"
              value={type}
              onChange={(e) => setParam('type', e.target.value)}
              className="h-9 min-w-0 flex-1 border border-souk-hair bg-souk-surface1 px-2 font-mono text-[10px] uppercase tracking-[0.06em] text-souk-slate sm:hidden"
            >
              {jobSorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <Txt size={12} lead={16} mono tone="steel" className="hidden sm:block">
              {result
                ? `${result.total.toLocaleString('en-US')} matching`
                : 'reading the shelf'}
            </Txt>
            <Row align="center" gap={4} className="ml-auto hidden flex-wrap sm:flex">
              <Txt size={10} lead={12} tone="muted" className="uppercase tracking-wide">
                Sort
              </Txt>
              {defaultSorts.map((s) => (
                <SortButton
                  key={s.key}
                  active={metric === s.key}
                  title={'title' in s ? s.title : undefined}
                  onClick={() => setParam('metric', s.key)}
                >
                  {s.label}
                </SortButton>
              ))}
            </Row>
            <select
              aria-label="Sort agents"
              value={metric}
              onChange={(e) => setParam('metric', e.target.value)}
              className="h-9 min-w-0 flex-1 border border-souk-hair bg-souk-surface1 px-2 font-mono text-[10px] uppercase tracking-[0.06em] text-souk-slate sm:hidden"
            >
              {defaultSorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>

          {showFilters ? (
            <Row align="center" gap={20} className="flex-wrap border-t border-souk-hair py-3">
              <Switch
                checked={pcs}
                label="Show only agents that say they work with PancakeSwap"
                onChange={() => setParam('pcs', pcs ? '' : '1')}
              >
                PancakeSwap
              </Switch>
              {/* the sector tag composes with the category, and exists only
                  while at least one agent on the shelf carries it */}
              {result?.sectors?.includes('stocks') ? (
                <Switch
                  checked={sector === 'stocks'}
                  label="Show only tokenized stocks"
                  onChange={() => setParam('sector', sector === 'stocks' ? '' : 'stocks')}
                >
                  Tokenized stocks
                </Switch>
              ) : null}
              <Switch
                checked={owned}
                label="Show only agents Agent Souk runs: the operator wallet owns these on chain, disclosed the same way on every card"
                onChange={() => setParam('owned', owned ? '' : '1')}
              >
                Agent Souk owned
              </Switch>
              <Switch
                checked={hide}
                label="Hide unresponsive agents"
                onChange={() => setParam('hide', hide ? '' : '1')}
              >
                Hide unresponsive
              </Switch>
              <Switch
                checked={verifiedOnly}
                label="Verified only"
                onChange={() => setParam('verified', verifiedOnly ? '' : '1')}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  Verified only
                </span>
              </Switch>
              <button
                type="button"
                onClick={() => setSp(new URLSearchParams(), { replace: true })}
                className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-souk-muted transition hover:text-souk-ink"
              >
                Clear
              </button>
            </Row>
          ) : null}

          {showLegend ? (
            <Row align="center" gap={20} className="flex-wrap border-t border-souk-hair py-3">
              <Txt size={10} lead={14} weight="bold" upper tone="muted">
                The five states, in the order they cost you
              </Txt>
              {LEGEND.map((k) => (
                <Row key={k.label} align="center" gap={7}>
                  <Dot tone={k.tone} size={8} />
                  <Txt size={11} lead={16} tone="slate">
                    {k.label}
                  </Txt>
                </Row>
              ))}
            </Row>
          ) : null}
        </div>
        </Section>

        {/* the grid band: the state key folded into the control bar above, so the
            cards start directly under it and the pagination closes the same band */}
        <Section pad="pt-6 pb-16">
        <Stack gap={24}>
        {result ? (
          <Row align="center" gap={12} className="flex-wrap">
            {/* new admissions moved to their own page, so the shelf keeps one
                disclosed placement and the strip has room to grow. the link
                stays even when there is no placement to show */}
            <Link
              to="/discover"
              className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-souk-slate underline decoration-souk-hair underline-offset-4 hover:text-souk-ink"
            >
              Discover new listings
            </Link>
          </Row>
        ) : null}
        {result ? <Rule /> : null}
        <Stack>
          {result?.source === 'unavailable' ? (
            <UnavailableState onRetry={() => setSp(new URLSearchParams(sp))} />
          ) : error ? (
            <ErrorState onRetry={() => setSp(new URLSearchParams(sp))} />
          ) : loading ? (
            <GridSkeleton />
          ) : result && visibleItems.length > 0 ? (
            <AgentGrid
              items={visibleItems}
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
        </Stack>

        {result && totalPages > 1 ? (
          <nav aria-label="Pagination">
            <Row justify="center" align="center" gap={20} className="flex-wrap">
              <Btn kind="off" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                ← Prev
              </Btn>
              <Txt size={11} lead={16} mono tone="muted">
                page {page} of {totalPages}
              </Txt>
              <Btn kind="off" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>
                Next →
              </Btn>
            </Row>
          </nav>
        ) : null}

        <Stack gap={8}>
          <Rule />
          <Txt size={11} lead={17} mono tone="muted">
            A probe proves reachability, a paid test hire proves delivery.
          </Txt>
        </Stack>
        </Stack>
        </Section>
      </div>

      <CompareBar
        count={shortlist.length}
        onClear={clearShortlist}
        onCompare={() => navigate(`/compare?ids=${shortlist.join(',')}`)}
      />
    </div>
  )
}

// The catalogue's freshness in one line: the store's own refresh time as a
// relative age when it is known and real. A future or unparseable refresh time
// is not freshness, so it says nothing rather than claiming a time that cannot
// be true. The committed snapshot's date is deliberately not shown: it is a
// build artifact, not a live reading, and a stale build should not read as a
// fresh shelf.
export function catalogueFreshnessLabel(
  catalogueRefreshedAt: string | null,
  now: number = Date.now(),
): string | null {
  const relative = catalogueRefreshedAt
    ? relativeAgeLabel(catalogueRefreshedAt, now)
    : null
  return relative ? `catalogue refreshed ${relative}` : null
}

// The shelf's source is a fact, not a mood: the shared store is the live
// catalogue, the snapshot is the committed fallback, and unavailable means
// neither answered.
export function catalogueSourceLabel(source?: 'store' | 'snapshot' | 'unavailable'): string {
  if (source === 'store') return 'shared store'
  if (source === 'snapshot') return 'snapshot fallback'
  if (source === 'unavailable') return 'catalogue unavailable'
  return 'reading source'
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

// the category reads as plain text with the active one ruled in data, the way the
// old shelf ruled its tabs rather than wrapping each in a pill
function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 cursor-pointer border-b-2 pb-[5px] text-[13px] uppercase leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data ${
        active
          ? 'border-souk-accent font-semibold text-souk-ink'
          : 'border-transparent text-souk-steel hover:text-souk-ink'
      }`}
    >
      {children}
    </button>
  )
}

// the sort keeps the old shelf's read: the one in force is a filled data chip,
// the rest sit as plain labels until picked
function SortButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`shrink-0 cursor-pointer rounded-[6px] px-3 py-[7px] text-[12px] font-bold uppercase leading-[16px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
        active
          ? 'bg-souk-accent text-souk-on-accent'
          : 'text-souk-steel hover:bg-souk-surface2 hover:text-souk-ink'
      }`}
    >
      {children}
    </button>
  )
}

// the switch in the dark system: the track is the nested surface, the knob the data colour
function Switch({
  checked,
  label,
  onChange,
  children,
}: {
  checked: boolean
  label: string
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <Txt size={11} lead={16} mono tone="steel">
        {children}
      </Txt>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative h-[18px] w-[34px] shrink-0 cursor-pointer rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
          checked ? 'border-souk-data bg-souk-data' : 'border-souk-hair bg-souk-surface2'
        }`}
      >
        <span
          className={`absolute top-[1px] h-[14px] w-[14px] rounded-full transition-all duration-150 ${
            checked ? 'left-[17px] bg-souk-canvas' : 'left-[1px] bg-souk-steel'
          }`}
        />
      </button>
    </label>
  )
}

export function AgentGrid({
  items,
  shortlist,
  onToggle,
}: {
  items: AgentSummary[]
  shortlist: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  const firstParty = isOperatedByAgentSouk(agent.owner_address)
  // our own agents carry a dicebear face, so the card shows it rather than the registry image
  const img = firstParty
    ? defaultAvatarFor(agent.chain_id, String(agent.token_id))
    : agent.image_url ?? defaultAvatarFor(agent.chain_id, String(agent.token_id))
  const key = `${agent.chain_id}/${agent.token_id}`
  const verdict = verdictFor(agent.chain_id, agent.verification)
  const jobOnly = sellsByJob(agent.skills)
  const score = agent.total_score > 0 ? formatScore(agent.total_score) : null
  const reviews = agent.total_feedbacks
  const when = agent.verification
    ? [
        agent.verification.responseMs > 0 ? `${agent.verification.responseMs}ms` : null,
        timeAgo(agent.verification.checkedAt),
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : null
  const declared = (agent.skills ?? [])
    .map((s) => (s as { price?: unknown }).price)
    .find((p): p is string => typeof p === 'string' && p.trim().length > 0)
  const price = declared ? declared.split(/\s+or\s+|,/)[0].trim() : takesJobs(agent.skills) ? 'Quote at hire' : 'Price at hire'
  const priceLabel = price.length > 26 ? `${price.slice(0, 25)}...` : price
  return (
    <article
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-[16px] border border-souk-hair souk-glass p-4 ${
        checked ? 'ring-1 ring-souk-data' : ''
      }`}
    >
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        onMouseEnter={() => prefetchAgent(agent.chain_id, String(agent.token_id))}
        onFocus={() => prefetchAgent(agent.chain_id, String(agent.token_id))}
        className="flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        <div className="flex items-start gap-3">
          <img
            src={img}
            alt=""
            loading="lazy"
            className="h-[46px] w-[46px] shrink-0 rounded-[12px] border border-souk-hair bg-souk-indigo object-cover"
            onError={(e) => {
              const el = e.currentTarget
              if (!el.dataset.fallback) {
                el.dataset.fallback = '1'
                el.src = defaultAvatarFor(agent.chain_id, String(agent.token_id))
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-souk-muted">
              {categoryName(agent.category)}
            </div>
            <div className="truncate font-serif text-[19px] font-semibold leading-[26px] tracking-[-0.01em] text-souk-ink">
              {agent.name}
            </div>
            <div className="truncate font-mono text-[10.5px] leading-4 text-souk-muted">
              {firstParty ? OPERATED_BY_LABEL : shortAddress(agent.owner_address)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="min-w-0 truncate font-mono text-[13px] text-souk-ink" title={price}>
            {priceLabel}
          </span>
          {agent.x402_supported ? (
            <span className="shrink-0 border border-souk-hair px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-souk-muted">
              x402
            </span>
          ) : null}
          <OnChainBadge
            online={takesVault(agent.skills) || classifyExecution(agent.description ?? '').executes}
            className="ml-auto shrink-0"
          />
        </div>

        <span title={verdict.explain} className="inline-flex">
          <Row align="center" gap={7}>
            <Dot
              tone={verdict.label === 'Verified' ? 'verified' : verdict.label === 'Online' ? 'online-fixed' : VERDICT_TONE[verdict.tone]}
              size={7}
            />
            <Txt size={11} lead={16} tone="slate">
              {verdict.label}
            </Txt>
            {when ? (
              <Txt size={11} lead={16} tone="muted">
                {`· ${when}`}
              </Txt>
            ) : null}
          </Row>
        </span>

        <p className="line-clamp-2 text-[12.5px] leading-[1.5] text-souk-slate">
          {agent.description || 'No description on-chain.'}
        </p>

      </Link>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-souk-hair pt-2 font-mono text-[10px] text-souk-muted">
        <span className="whitespace-nowrap text-souk-data">{`#${agent.token_id}`}</span>
        {score ? <span>{`score ${score}`}</span> : null}
        {reviews > 0 ? <span>{`${formatNumber(reviews)} review${reviews === 1 ? '' : 's'}`}</span> : null}
        <button
          type="button"
          onClick={() => onToggle(key)}
          aria-pressed={checked}
          aria-label={`Compare: ${agent.name}`}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-[10px] uppercase tracking-[0.06em] text-souk-muted transition hover:text-souk-data focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
        >
          <span
            aria-hidden="true"
            className={`grid h-3 w-3 place-items-center border ${
              checked ? 'border-souk-data bg-souk-data/30' : 'border-souk-steel'
            }`}
          >
            {checked ? <span className="h-1.5 w-1.5 bg-souk-data" /> : null}
          </span>
          Compare
        </button>
      </div>
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        title={
          jobOnly
            ? 'This agent sells by ERC-8183 job: it quotes a price, the job is funded in escrow, and it is paid on delivery.'
            : undefined
        }
        className="micro font-mono mt-auto flex h-10 items-center justify-center gap-1.5 rounded-[6px] border border-souk-hair bg-souk-accent tracking-[0.08em] text-souk-on-accent transition hover:bg-souk-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        Hire
        <span
          aria-hidden="true"
          className="font-mono text-[13px] leading-none transition-transform group-hover:translate-x-1"
        >
          →
        </span>
        <span className="sr-only">: {agent.name}</span>
      </Link>
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
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <Stack key={i} surface gap={12} pad={[20, 22, 20, 22]} className="animate-pulse">
          <Row align="center" gap={11}>
            <span className="h-[56px] w-[56px] shrink-0 rounded-[8px] bg-souk-surface2" />
            <Stack gap={6} className="flex-1">
              <span className="h-3 w-20 rounded-[4px] bg-souk-surface2" />
              <span className="h-4 w-32 rounded-[4px] bg-souk-surface2" />
            </Stack>
          </Row>
          <span className="h-3 w-full rounded-[4px] bg-souk-surface2" />
          <span className="h-3 w-3/4 rounded-[4px] bg-souk-surface2" />
          <Rule />
          <span className="h-3 w-40 rounded-[4px] bg-souk-surface2" />
        </Stack>
      ))}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Stack surface pad={[40, 40, 40, 40]} gap={12} className="items-center text-center">
      <Txt size={20} lead={26} weight="bold" tone="ink">
        Could not reach the market.
      </Txt>
      <Txt size={13} lead={20} tone="slate">
        The catalogue service did not respond. It should be back shortly.
      </Txt>
      <Btn kind="primary" onClick={onRetry} className="mt-4">
        Retry
      </Btn>
    </Stack>
  )
}

function UnavailableState({ onRetry }: { onRetry: () => void }) {
  return (
    <Stack surface pad={[40, 40, 40, 40]} gap={12} className="items-center text-center">
      <Txt size={20} lead={26} weight="bold" tone="ink">
        The market cannot be read.
      </Txt>
      <Txt size={13} lead={20} tone="slate">
        The registry did not answer, and no cached list is served in its place.
      </Txt>
      <Btn kind="primary" onClick={onRetry} className="mt-4">
        Retry
      </Btn>
    </Stack>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <Stack surface pad={[40, 40, 40, 40]} gap={12} className="items-center text-center">
      <Txt size={20} lead={26} weight="bold" tone="ink">
        Nothing matches.
      </Txt>
      <Txt size={13} lead={20} tone="slate">
        No agent fits that filter. Clear it to see the full catalogue.
      </Txt>
      <Btn kind="primary" onClick={onReset} className="mt-4">
        Show all agents
      </Btn>
    </Stack>
  )
}

// the market's own last settlements, told as a log rather than a claim. one line
// per hire, with the money in the settled colour so the proof reads first