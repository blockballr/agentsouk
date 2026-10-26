import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentSummary } from '../core/types'
import { defaultAvatarFor } from '../lib/default-avatar'
import { CATEGORIES, formatNumber, formatScore, sellsByJob, takesJobs, takesVault, shortAddress, timeAgo, classifyExecution } from '@agora/core'
import { CompareBar } from '../components/CompareBar'
import { OnChainBadge } from '../components/OnChainBadge'
import { Tag } from '../components/Tag'
import { getAgents } from '../lib/api'
import { chainLabel, explorerAddressUrl, registryFor, settlementAssetFor } from '../lib/contracts'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'

import { OPERATED_BY_LABEL, OPERATED_BY_TITLE, isOperatedByAgentSouk } from '../lib/first-party'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { Section, Stack, Row, Txt, Dot, Rule, Btn, type DotTone } from '../components/souk'

// The sorts are the four metrics a buyer picks from; reachability is not one of
// them because it is not a choice. It settles the ties underneath every metric,
// so an agent that answered its last probe outranks one never checked, and job
// capability leads all of it. Picking a metric names what leads the chain, not
// what replaces that order.
const jobSorts = [
  {
    key: 'jobs',
    label: 'ESCROW',
    title: 'Escrow sellers lead: agents that sell both jobs and x402 ahead of jobs-only, then direct-call x402 agents, then the rest.',
  },
  {
    key: 'x402',
    label: 'x402',
    title: 'Direct-call x402 agents lead, then job sellers, then the rest.',
  },
  {
    key: 'vault',
    label: 'VAULT',
    title: 'Funded HireVault agents lead: the agents whose card declares a vault hire, where the deposit stays in the vault and one withdraw returns the balance.',
  },
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
  // no sort named reads as score, the chain's first metric; reachability is not
  // a choice here, it settles the ties underneath whichever metric is picked,
  // and job capability leads every one of them
  const type = (sp.get('type') ?? 'jobs') as 'all' | 'jobs' | 'x402' | 'vault'
  const metric = (sp.get('metric') ?? 'score') as 'score' | 'newest' | 'feedback' | 'health'
  const pcs = sp.get('pcs') === '1'
  const hide = sp.get('hide') === '1'
  const verifiedOnly = sp.get('verified') === '1'
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const PAGE_SIZE = 48

  const [result, setResult] = useState<{
    items: AgentSummary[]
    snapshotTotal: number | null
    shelved: number | null
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
    getAgents({ category, q, type, metric, page, limit: PAGE_SIZE, pcs })
      .then((r) => {
        if (!cancelled) {
          setResult({
            items: r.items,
            snapshotTotal: r.snapshotTotal,
            shelved: r.shelved,
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
  }, [category, q, type, metric, pcs, page])

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

  // the shelf's strap: the chain it reads, how many listings the registry holds,
  // how many of them are curated onto the shelf, and how fresh that reading is.
  // A part the market has not answered for is dropped, not guessed.
  const strap = [
    'shelf',
    chainId === null ? 'checking the network' : `${chainLabel(chainId)} ${chainId}`,
    result?.registryTotal ? `${result.registryTotal.toLocaleString('en-US')} agents` : null,
    (result?.shelved ?? result?.snapshotTotal)
      ? `${(result?.shelved ?? result?.snapshotTotal)!.toLocaleString('en-US')} shelved`
      : null,
    freshness,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-8 pb-[240px] xl:pb-16">
        {/* the register's masthead wash, driven by the theme's own variable: deep-sea
            in the dark register, the drawn sky wash on paper. the 3px rail and the
            hairline gloss separate a masthead from the page it opens */}
        <div className="-mx-8 mb-8 rounded-b-[20px] border-b-[3px] border-souk-canvas bg-[linear-gradient(117deg,var(--mast-wash),transparent_70%)] px-8 shadow-[0_3px_0_-1px_var(--color-souk-hair)]">
        {/* the hero band keeps its own top padding and carries the lower half of the
            rhythm, so the shelf opens right under the bar and still breathes below */}
        <Section pad="pt-11 pb-16 md:pb-18">
        <Stack gap={10}>
          <Row justify="between" align="center" gap={16} className="flex-wrap">
            <Txt size={11} lead={16} mono upper tone="data">
              {strap}
            </Txt>
            {/* the proof lives on /about, but a reviewer who lands here must still
                see the chain and asset the market actually settles in */}
            <Row align="center" gap={16} className="flex-wrap">
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
                  title={`ERC-8004 identity registry ${registry} on ${chainLabel(chainId)}`}
                  className="font-mono text-[11px] leading-4 text-souk-sky transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                >
                  ERC-8004 registry ↗
                </a>
              ) : null}
            </Row>
          </Row>

          <Row align="baseline" gap={12} className="flex-wrap">
            <Txt size={34} lead={42} display weight="bold" tone="ink">
              {category === 'all' ? 'Hire from the shelf.' : labelFor(category)}
            </Txt>
            {loading && !result ? (
              <Txt size={11} lead={16} mono upper tone="muted">
                loading agents
              </Txt>
            ) : null}
          </Row>
        </Stack>
        </Section>
        </div>

        {/* the controls band: categories, sorts; it carries the full
            rhythm on both sides so the shelf's working part is its own island */}
        <Section>
        <Stack gap={16}>
          <Row align="center" gap={24} className="flex-wrap">
            <Tab active={category === 'all'} onClick={() => setParam('category', 'all')}>
              All
            </Tab>
            {CATEGORIES.map((c) => (
              <Tab key={c.key} active={category === c.key} onClick={() => setParam('category', c.key)}>
                {c.label}
              </Tab>
            ))}
            <Row align="center" gap={20} className="flex-wrap">
              <Switch
                checked={pcs}
                label="Show only agents that say they work with PancakeSwap"
                onChange={() => setParam('pcs', pcs ? '' : '1')}
              >
                PancakeSwap
              </Switch>
              {pcs && result ? (
                <Txt size={11} lead={16} mono tone="muted">
                  {`${result.total} pancakeswap`}
                </Txt>
              ) : null}
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
              {hide && result ? (
                <Txt size={11} lead={16} mono tone="muted">
                  {`${visibleItems.length} shown`}
                </Txt>
              ) : null}
            </Row>
          </Row>

          {/* the sort row reads from the right: the search the hero used to hold sits
              ahead of the sorts, so one row carries find and order together */}
          <Stack gap={8} className="items-end">
            <Row align="center" justify="end" gap={12} className="flex-wrap">
              <Row
                align="center"
                pad={[0, 6, 0, 14]}
                radius={8}
                bg="surface2"
                hair
                className="h-10 w-full sm:w-[300px]"
              >
                <label className="sr-only" htmlFor="search">
                  Search agents
                </label>
                <input
                  id="search"
                  type="search"
                  value={q}
                  onChange={(e) => setParam('q', e.target.value)}
                  placeholder="Search agents, skills, endpoints"
                  className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
                />
              </Row>
              <Row align="center" gap={6}>
                <Txt size={10} lead={12} tone="muted" className="uppercase tracking-wide">
                  Hire Type
                </Txt>
                {jobSorts.map((s) => (
                  <SortButton
                    key={s.key}
                    active={type === s.key}
                    title={'title' in s ? s.title : undefined}
                    onClick={() => setParam('type', s.key)}
                  >
                    {s.label}
                  </SortButton>
                ))}
              </Row>
            </Row>
            <Row align="center" justify="end" gap={6}>
              <Txt size={10} lead={12} tone="muted" className="uppercase tracking-wide">
                Metric
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
          </Stack>


        </Stack>
        </Section>

        {/* the grid band: the legend sits above the cards as their key, and the
            pagination closes the same band rather than starting a new one */}
        <Section>
        <Stack gap={24}>
        <Stack gap={10}>
          <Txt size={10} lead={14} weight="bold" upper tone="muted">
            The five states, in the order they cost you
          </Txt>
          <Row align="center" gap={20} className="flex-wrap">
            {LEGEND.map((k) => (
              <Row key={k.label} align="center" gap={7}>
                <Dot tone={k.tone} size={8} />
                <Txt size={12} lead={16} tone="slate">
                  {k.label}
                </Txt>
              </Row>
            ))}
          </Row>
        </Stack>

        <Stack>
          {error ? (
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

// the category reads as plain text with the active one ruled in data, the way the
// old shelf ruled its tabs rather than wrapping each in a pill
function Tab({
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
      aria-pressed={active}
      className={`shrink-0 cursor-pointer border-b-2 pb-[5px] text-[13px] uppercase leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data ${
        active
          ? 'border-souk-data font-semibold text-souk-ink'
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
          ? 'bg-souk-data text-souk-canvas'
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
  const img = agent.image_url ?? defaultAvatarFor(agent.chain_id, String(agent.token_id))
  const key = `${agent.chain_id}/${agent.token_id}`
  const verdict = verdictFor(agent.chain_id, agent.verification)
  const firstParty = isOperatedByAgentSouk(agent.owner_address)
  const boosted = (agent as { boosted?: boolean }).boosted
  // the server refuses a direct hire to a pure job seller before anyone signs,
  // so the card refuses to add one to the cart instead of letting checkout fail;
  // a dual-lane agent still carries the cart because its x402 call is buyable
  const jobOnly = sellsByJob(agent.skills)
  // indexer figures are mostly zero on a young chain, so they show only when they say something
  const score = agent.total_score > 0 ? formatScore(agent.total_score) : null
  const reviews = agent.total_feedbacks
  // the design's meta line: how long the last check took and when it ran
  const when = agent.verification
    ? [
        agent.verification.responseMs > 0 ? `${agent.verification.responseMs}ms` : null,
        timeAgo(agent.verification.checkedAt),
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : null
  return (
    <Stack
      surface
      gap={12}
      pad={[20, 22, 20, 22]}
      // the card answers to its own width, so four-across on a narrow screen
      // stacks its actions instead of squeezing them into a wrap
      className={checked ? 'ring-1 ring-souk-data @container relative' : '@container relative'}
    >
      <OnChainBadge
        online={takesVault(agent.skills) || classifyExecution(agent.description ?? '').executes}
        className="absolute right-3 top-3"
      />
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        className="flex flex-col gap-3 rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        <Row align="center" gap={11}>
          <img
            src={img}
            alt=""
            loading="lazy"
            className="h-[56px] w-[56px] shrink-0 rounded-[8px] border border-souk-hair bg-souk-indigo object-cover"
            onError={(e) => {
              // a dead image_url falls back to the listing's own default face
              const el = e.currentTarget
              if (!el.dataset.fallback) {
                el.dataset.fallback = '1'
                el.src = defaultAvatarFor(agent.chain_id, String(agent.token_id))
              }
            }}
          />
          <Stack gap={2} className="min-w-0 flex-1">
            <Txt size={10} lead={14} weight="bold" upper tone="muted">
              {categoryName(agent.category)}
            </Txt>
            <Txt size={18} lead={26} weight="bold" tone="ink" className="truncate">
              {agent.name}
            </Txt>
            {firstParty ? (
              <span title={OPERATED_BY_TITLE} className="truncate">
                <Txt size={11} lead={16} tone="slate">
                  {OPERATED_BY_LABEL}
                </Txt>
              </span>
            ) : (
              <Txt size={11} lead={16} tone="steel" className="truncate">
                by <span className="font-mono">{shortAddress(agent.owner_address)}</span>
              </Txt>
            )}
          </Stack>
        </Row>

        <span title={verdict.explain} className="inline-flex">
          <Row align="center" gap={8}>
            <Dot tone={verdict.label === 'Verified' ? 'verified' : verdict.label === 'Online' ? 'online-fixed' : VERDICT_TONE[verdict.tone]} size={9} />
            <Txt size={14} lead={20} tone="slate">
              {verdict.label}
            </Txt>
            {agent.verification?.checkedAt ? (
              <Txt size={11} lead={16} tone="muted">
                {timeAgo(agent.verification.checkedAt)}
              </Txt>
            ) : null}
          </Row>
        </span>

        <Txt size={13} lead={20} tone="slate" className="line-clamp-2">
          {agent.description || 'No description on-chain.'}
        </Txt>

        <Row align="center" gap={6} className="flex-wrap">
          <Tag title="The ERC-8004 registry id this listing reads from">#{agent.token_id}</Tag>
          {takesJobs(agent.skills) ? (
            <Tag title="Takes work as an ERC-8183 job: it quotes a price, the money is funded on chain and held in escrow, and it is paid on delivery">Executes jobs</Tag>
          ) : null}
          {agent.x402_supported ? <Tag title="Takes payment per call over x402">x402</Tag> : null}
          {agent.pcs ? <Tag title="Says it works with PancakeSwap">PancakeSwap</Tag> : null}
          {boosted ? <Tag title="Paid boost">Boosted</Tag> : null}
          {score ? <Tag title="8004scan total score">Score {score}</Tag> : null}
          {reviews > 0 ? (
            <Tag title="On-chain feedback entries">
              {formatNumber(reviews)} review{reviews === 1 ? '' : 's'}
            </Tag>
          ) : null}
        </Row>

        <Rule />

        <Row
          justify="between"
          align="center"
          gap={8}
          className="flex-col items-start @[380px]:flex-row @[380px]:items-center"
        >
          {/* both halves of the listing's identity: the shelf is a card grid with no
              table above it, so a token id alone would not say which chain it is on */}
          <Txt size={11} lead={16} mono tone="steel">
            {`BNB ${agent.chain_id} · #${agent.token_id}`}
          </Txt>
          {when ? (
            <Txt size={11} lead={16} mono tone="muted">
              {when}
            </Txt>
          ) : null}
        </Row>
      </Link>

      <div className="flex flex-col gap-2.5 @[380px]:flex-row">
        <Btn
          kind={checked ? 'keep' : 'off'}
          className="w-full min-w-0 @[380px]:basis-0 @[380px]:grow"
          onClick={() => onToggle(key)}
          aria-pressed={checked}
        >
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
                checked ? 'border-souk-data bg-souk-data/40' : 'border-souk-steel'
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
          </span>
        </Btn>
        {jobOnly ? (
          <Link
            to={`/agents/${agent.chain_id}/${agent.token_id}`}
            title="This agent sells by ERC-8183 job: it quotes a price, the job is funded in escrow, and it is paid on delivery. Get the quote on its page."
            className="inline-flex h-11 w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair bg-souk-surface1 text-souk-slate transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data @[380px]:basis-0 @[380px]:grow"
          >
            <span className="text-[14px] font-semibold leading-[20px]">Get price</span>
            <span className="sr-only">: {agent.name} quotes a job on its page</span>
          </Link>
        ) : (
          <Link
            to={`/agents/${agent.chain_id}/${agent.token_id}`}
            className="inline-flex h-11 w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair bg-souk-surface1 text-souk-slate transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data @[380px]:basis-0 @[380px]:grow"
          >
            <span className="text-[14px] font-semibold leading-[20px]">View agent</span>
            <span className="sr-only">: {agent.name}</span>
          </Link>
        )}
      </div>
    </Stack>
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
              <span className="h-3 w-20 rounded-[3px] bg-souk-surface2" />
              <span className="h-4 w-32 rounded-[3px] bg-souk-surface2" />
            </Stack>
          </Row>
          <span className="h-3 w-full rounded-[3px] bg-souk-surface2" />
          <span className="h-3 w-3/4 rounded-[3px] bg-souk-surface2" />
          <Rule />
          <span className="h-3 w-40 rounded-[3px] bg-souk-surface2" />
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
