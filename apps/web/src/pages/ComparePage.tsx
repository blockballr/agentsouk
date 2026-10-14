import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentDetail, AgentSummary } from '../core/types'
import {
  CATEGORIES,
  JOB_SELLER_NOTE,
  formatNumber,
  formatScore,
  isJobStepSkill,
  sellsByJob,
  takesJobs,
  shortAddress,
  timeAgo,
} from '@agora/core'
import { getAgentDetail, getAgents, getCompareCommentary } from '../lib/api'
import { bestByCategory, categoryGroups, categoryOf } from '../lib/compare'
import { CompareBar } from '../components/CompareBar'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'
import { OPERATED_BY_LABEL, OPERATED_BY_TITLE, isOperatedByAgentSouk } from '../lib/first-party'
import { builtWithFrom } from '../lib/onchain-meta'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { chainLabel } from '../lib/contracts'
import {
  AgentAvatar,
  Btn,
  DataTable,
  Dot,
  IconTrophy,
  NoteBox,
  Pill,
  Row,
  Rule,
  SectionHead,
  Stack,
  Txt,
  type DotTone,
  type TableRowSpec,
} from '../components/souk'

// the verdict's four tones in the design's five-state dot grammar
const VERDICT_TONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

// the check's own stamp, read off the verification record in UTC
function utcStamp(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ]
  return `${time} · ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
}

// the rails an agent actually answers on, read off its record for the head chips
function railsFor(a: AgentDetail): string[] {
  const rails: string[] = []
  if (a.a2a_endpoint || a.agent_url) rails.push('a2a')
  if (a.x402_supported) rails.push('x402')
  if (sellsByJob(a.skills) || takesJobs(a.skills)) rails.push('erc-8183')
  return rails
}

export function ComparePage() {
  const [sp, setSp] = useSearchParams()
  const urlIds = useMemo(
    () =>
      (sp.get('ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [sp],
  )

  const [shortlistIds, setShortlistIds] = useState<string[]>(() => getShortlist())

  // selecting agents must never swap the view or navigate; the table renders only from url
  // ids after an explicit Compare click, so the picker stays put for multi-select
  const effectiveIds = useMemo(() => (urlIds.length > 0 ? urlIds : []), [urlIds])

  function toggleId(id: string) {
    if (urlIds.length > 0) {
      const next = urlIds.includes(id) ? urlIds.filter((x) => x !== id) : [...urlIds, id]
      persistShortlist(next)
      const nextSp = new URLSearchParams()
      if (next.length > 0) nextSp.set('ids', next.join(','))
      setSp(nextSp, { replace: true })
      return
    }
    // shortlist-driven mode: toggle storage and let effectiveIds follow
    setShortlistIds(toggleShortlist(id))
  }

  function clearSelection() {
    setShortlistIds([])
    persistShortlist([])
    setSp(new URLSearchParams(), { replace: true })
  }

  // settled hires leave the table selection, shortlist, and url ids so the
  // floating bar count is what is left to hire, not what was already paid
  function handleHired(keys: string[]) {
    const hired = new Set(keys)
    const hiredTokenIds = new Set(keys.map((k) => k.split('/')[1]))
    setSelectedIds((prev) =>
      prev.filter((id) => !hiredTokenIds.has(id.split(':').pop() ?? '')),
    )
    const source = effectiveIds.length > 0 ? effectiveIds : shortlistIds
    const next = source.filter((id) => !hired.has(id))
    setShortlistIds(next)
    persistShortlist(next)
    if (effectiveIds.length > 0) {
      const nextSp = new URLSearchParams()
      if (next.length > 0) nextSp.set('ids', next.join(','))
      setSp(nextSp, { replace: true })
    }
  }

  // same floating bar as the marketplace; with url ids the action anchors the
  // table, from the picker it navigates explicitly to the shortlisted set
  function scrollToTable() {
    document.getElementById('compare-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function goCompare() {
    const nextSp = new URLSearchParams()
    if (shortlistIds.length > 0) nextSp.set('ids', shortlistIds.join(','))
    setSp(nextSp)
  }

  const [agents, setAgents] = useState<AgentDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // per-agent hire selection over the current table agents; the best of each category
  // starts checked and the bar's count always equals this selection
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // re-sync selection to the bests of every freshly loaded set (or the whole set when no
  // bests exist), so stale selections from an earlier compare die here
  // a job-only seller refuses a direct hire, so the pick in each category is the best agent
  // that can be hired directly, even when a job seller holds the Best badge
  useEffect(() => {
    if (agents.length === 0) return
    const hireable = agents.filter((a) => !sellsByJob(a.skills))
    const winners = Object.values(bestByCategory(hireable)).filter((id): id is string => id !== null)
    setSelectedIds(winners.length > 0 ? winners : hireable.map((a) => a.agent_id))
  }, [agents])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectedAgents = useMemo(
    () =>
      agents
        .filter((a) => selectedIds.includes(a.agent_id))
        .map((a) => ({ chainId: a.chain_id, tokenId: Number(a.token_id), name: a.name })),
    [agents, selectedIds],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    if (effectiveIds.length > 0) {
      const fetchKey = (id: string) => {
        const [chainId = '56', tokenId = id] = id.split('/')
        return getAgentDetail(chainId, tokenId)
      }
      Promise.all(effectiveIds.map(fetchKey))
        .then((ds) => {
          if (!cancelled) setAgents(ds.filter((d): d is AgentDetail => d !== null))
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    } else {
      // no selection yet: show the picker view instead of loading data
      setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [effectiveIds])

  // the strap carries only what the table actually read: the count on it and the
  // newest check that landed, in UTC
  const newestCheck = useMemo(
    () =>
      agents
        .map((a) => a.verification?.checkedAt)
        .filter((t): t is string => Boolean(t))
        .sort()
        .at(-1) ?? null,
    [agents],
  )
  const strapParts = [`compare`, `${agents.length} agents`]
  if (newestCheck) {
    const stamp = utcStamp(newestCheck)
    if (stamp) strapParts.push(`read ${stamp}`)
  }

  return (
    <section className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-8 pb-24">
        <Stack gap={10} pad={[32, 0, 0, 0]}>
          {effectiveIds.length > 0 ? (
            <Txt size={11} lead={16} mono upper tone="data">
              {strapParts.join(' · ')}
            </Txt>
          ) : (
            <Txt size={11} lead={16} mono upper tone="data">
              compare
            </Txt>
          )}
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Side by side.
          </Txt>
          {effectiveIds.length > 0 ? (
            <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
              Two or three agents off the shelf, one row per fact, every figure read off the record
              the shelf reads. A field the record does not carry says so, and a zero that was never
              earned stays a zero.
            </Txt>
          ) : null}
        </Stack>

        {effectiveIds.length === 0 ? (
          <Picker selected={shortlistIds} onToggle={toggleId} onClear={clearSelection} />
        ) : (
          <>
            <CompareTable
              agents={agents}
              loading={loading}
              error={error}
              onClear={clearSelection}
              checkedIds={selectedIds}
              onToggleChecked={toggleSelected}
            />
            {!loading && !error && agents.length >= 2 && <CompareCommentary agents={agents} />}
            <Row align="start" gap={20} pad={[20, 0, 0, 0]} className="flex-wrap">
              <Stack gap={12} className="min-w-[420px] flex-1">
                <ShortlistSearch selected={effectiveIds} onToggle={toggleId} />
              </Stack>
            </Row>
            <Stack gap={8} pad={[20, 0, 0, 0]}>
              <Rule />
              <Txt size={12} lead={18} tone="muted" className="block">
                Best in each category goes to the agent whose last check went best, then the higher
                registry score, then more reviews.
              </Txt>
            </Stack>
          </>
        )}
        <CompareBar
          count={effectiveIds.length > 0 ? effectiveIds.length : shortlistIds.length}
          ids={effectiveIds.length > 0 ? effectiveIds : shortlistIds}
          onClear={clearSelection}
          onCompare={effectiveIds.length > 0 ? scrollToTable : goCompare}
          onHired={handleHired}
          // derive the actions from the RENDERED table agents: selection is re-synced on every load,
          // so the counts always equal what the actions act on
          hire={effectiveIds.length > 0 && !loading && !error && agents.length > 0 ? { winners: selectedAgents } : undefined}
        />
      </div>
    </section>
  )
}

function Picker({
  selected,
  onToggle,
  onClear,
}: {
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [category, setCategory] = useState<string>('all')
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAgents({ category, q, limit: 12 })
      .then((r) => {
        if (!cancelled) setOptions(r.items)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category, q])

  function toggle(id: string) {
    onToggle(id)
  }

  const keyFor = (a: AgentSummary) => `${a.chain_id}/${a.token_id}`

  return (
    <div>
      <Row align="center" gap={14} pad={[20, 0, 0, 0]} className="flex-wrap">
        <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c.key}
            active={category === c.key}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </FilterChip>
        ))}
        <Row
          align="center"
          gap={12}
          radius={8}
          bg="surface2"
          hair
          pad={[0, 6, 0, 18]}
          className="h-11 w-full max-w-[1180px] sm:w-96"
        >
          <label className="sr-only" htmlFor="compare-search">
            Search agents
          </label>
          <input
            id="compare-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, endpoint or tag"
            className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
          />
        </Row>
      </Row>

      <Row align="center" gap={16} pad={[14, 0, 0, 0]}>
        <Txt size={11} lead={16} mono tone={selected.length > 0 ? 'data' : 'muted'}>
          {selected.length > 0
            ? `${selected.length} shortlisted`
            : 'nothing shortlisted yet'}
        </Txt>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-bold uppercase text-souk-steel transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
          >
            Clear
          </button>
        )}
      </Row>

      {loading ? (
        <div className="mt-6 animate-pulse space-y-3" role="status" aria-label="Loading candidates">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 rounded-[8px] bg-souk-surface2" />
          ))}
        </div>
      ) : (
        <Stack surface className="mt-6">
          {options.map((a) => {
            const key = keyFor(a)
            const checked = selected.includes(key)
            return (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-5 border-b border-souk-edge px-5 py-4 transition last:border-b-0 focus-within:bg-souk-data/10 ${
                  checked ? 'bg-souk-data/10' : 'hover:bg-souk-surface2'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(key)}
                  className="h-4 w-4 accent-souk-data"
                />
                <AgentAvatar size={34} name={a.name} imageUrl={a.image_url} />
                <span className="min-w-0 flex-1">
                  <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">
                    {a.name}
                  </Txt>
                  <Txt size={11} lead={15} mono tone="labels" className="mt-0.5 block">
                    {categoryName(a.category)} ·{' '}
                    {isOperatedByAgentSouk(a.owner_address) ? OPERATED_BY_LABEL : shortAddress(a.owner_address)}
                  </Txt>
                </span>
                <VerdictInline agent={a} />
              </label>
            )
          })}
        </Stack>
      )}

    </div>
  )
}

function CompareTable({
  agents,
  loading,
  error,
  onClear,
  checkedIds,
  onToggleChecked,
}: {
  agents: AgentDetail[]
  loading: boolean
  error: boolean
  // carried for the drawing's empty state alone: a populated table has no right hand
  // slot on its callout row, and the picker and the bar each hold their own clear
  onClear: () => void
  checkedIds: string[]
  onToggleChecked: (id: string) => void
}) {
  const winnerIds = useMemo(
    () => new Set(Object.values(bestByCategory(agents)).filter((id): id is string => id !== null)),
    [agents],
  )
  // one column per category: only its best agent is surfaced, so a table comparing
  // all four categories holds at most four columns and never scrolls sideways; the
  // ledger below still lists every agent and how each result was arrived at
  const columns = useMemo(() => {
    const best = bestByCategory(agents)
    return categoryGroups(agents).flatMap((g) => {
      const winner = g.agents.find((a) => a.agent_id === best[g.category])
      return winner ? [{ agent: winner, category: g.label }] : []
    })
  }, [agents])

  const cats = useMemo(() => [...new Set(columns.map((c) => c.category))], [columns])
  const catLabel = cats.length === 1 ? cats[0] : `${cats.length} categories`

  const rows: { label: string; cell: (a: AgentDetail) => ReactNode }[] = [
    {
      label: 'Last check',
      cell: (a) => {
        const v = verdictFor(a.chain_id, a.verification)
        return (
          <span className="block" title={v.explain}>
            <span className="flex items-center gap-2">
              <Dot tone={VERDICT_TONE[v.tone]} size={8} />
              <Txt size={13} lead={19} weight="semibold" tone="slate">
                {v.label}
              </Txt>
            </span>
            {a.verification ? (
              <Txt size={11} lead={15} tone="muted" className="mt-0.5 block">
                checked {timeAgo(a.verification.checkedAt)}
              </Txt>
            ) : null}
          </span>
        )
      },
    },
    {
      label: 'How you pay',
      // our relay settles a direct hire whatever the agent advertises, so only job sellers
      // differ; an agent that takes both rails says so rather than picking one
      cell: (a) =>
        sellsByJob(a.skills)
          ? 'By ERC-8183 job'
          : takesJobs(a.skills)
            ? 'Per call, x402, or ERC-8183 job'
            : 'Per call, x402',
    },
    {
      label: 'What it does',
      cell: (a) => {
        const names = (a.skills ?? [])
          .filter((s) => !isJobStepSkill(s, a.skills ?? []))
          .map((s) => s.name ?? s.id)
          .filter((n): n is string => Boolean(n))
        if (names.length === 0)
          return <Txt size={13} lead={19} tone="muted">{a.description?.slice(0, 90) || 'No skill list'}</Txt>
        return (
          <span className="block space-y-0.5">
            {names.slice(0, 3).map((n) => (
              <Txt key={n} size={13} lead={19} tone="slate" className="block">
                {n}
              </Txt>
            ))}
            {names.length > 3 ? (
              <Txt size={13} lead={19} tone="muted" className="block">
                and {names.length - 3} more
              </Txt>
            ) : null}
          </span>
        )
      },
    },
    { label: 'Registry score', cell: (a) => <Txt size={16} lead={22} mono tone="data">{formatScore(a.total_score)}</Txt> },
    {
      label: 'Reviews',
      cell: (a) => <Txt size={14} lead={20} mono tone={a.total_feedbacks === 0 ? 'steel' : 'data'}>{formatNumber(a.total_feedbacks)}</Txt>,
    },
    {
      label: 'Health',
      cell: (a) => <Txt size={14} lead={20} mono tone="ink">{a.health_score !== null ? formatScore(a.health_score) : 'n/a'}</Txt>,
    },
    {
      label: 'Built with',
      cell: (a) => {
        const b = builtWithFrom(a.raw_metadata?.onchain ?? [])
        return b ? (
          <Txt size={13} lead={19} tone="slate">{b.label}</Txt>
        ) : (
          <Txt size={13} lead={19} tone="muted">Not stated</Txt>
        )
      },
    },
    {
      label: 'Owner',
      cell: (a) =>
        isOperatedByAgentSouk(a.owner_address) ? (
          <Txt size={13} lead={19} tone="slate" className="block" >
            <span title={OPERATED_BY_TITLE}>{OPERATED_BY_LABEL}</span>
          </Txt>
        ) : (
          <Txt size={12} lead={18} mono tone="slate" className="block">
            {shortAddress(a.owner_address)}
          </Txt>
        ),
    },
  ]

  // the check ledger behind each verdict: what the record carries and, where the
  // record carries nothing, the words that say so rather than a borrowed figure
  const ledgerNote = (() => {
    const ran = newestVerification(agents)
    const parts: string[] = []
    if (ran?.checkedAt) {
      const stamp = utcStamp(ran.checkedAt)
      if (stamp) parts.push(`ran ${stamp}`)
    }
    parts.push('no evidence hash', 'no expiry')
    return parts.join(' · ')
  })()
  const ledgerRows: TableRowSpec[] = agents.map((a) => {
    const v = verdictFor(a.chain_id, a.verification)
    return {
      height: 36,
      cells: [
        { text: a.name, size: 13, lead: 19, weight: 'semibold', tone: 'slate' },
        { text: v.label, size: 13, lead: 19, weight: 'semibold', tone: v.tone === 'held' ? 'peach' : 'steel' },
        {
          text: a.verification?.quality ? a.verification.quality.grade : 'none yet',
          size: 13,
          lead: 19,
          tone: a.verification?.quality ? 'data' : 'muted',
        },
        {
          text: a.verification?.quality?.reason ?? 'no check ran',
          size: 12,
          lead: 18,
          tone: a.verification?.quality?.reason ? 'steel' : 'muted',
        },
        {
          text: a.verification ? `${a.verification.responseMs}ms` : 'none yet',
          mono: Boolean(a.verification),
          size: 13,
          lead: 19,
          tone: a.verification ? 'data' : 'muted',
        },
        { text: 'no evidence hash', size: 13, lead: 19, tone: 'muted' },
        { text: 'no expiry set', size: 13, lead: 19, tone: 'muted' },
      ],
    }
  })

  return (
    <div id="compare-table" className="scroll-mt-8">
      {error || agents.length === 0 ? (
        <CompareEmpty failed={error} onPickAgain={onClear} />
      ) : loading ? (
        <div className="mt-12 animate-pulse space-y-3" role="status" aria-label="Loading comparison">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-14 rounded-[8px] bg-souk-surface2" />
          ))}
        </div>
      ) : (
        <>
          {/* the drawing's callout row: the category and the count, gap 10, no right
            hand slot. Clearing stays with the picker and the floating bar */}
        <Row align="center" gap={10} pad={[24, 0, 0, 0]}>
          <Txt size={11} lead={16} weight="bold" upper tone="data">
            {catLabel}
          </Txt>
          <Txt size={11} lead={16} tone="muted">
            {agents.length} agents
            {cats.length === 1 ? ', one category' : ''}
          </Txt>
        </Row>

          {/* every column is that category's winner, so the card's edge is the only
              boundary: the table fits its container rather than scrolling sideways */}
          <Stack surface className="w-full">
            <table
              className="w-full border-collapse text-left"
              style={{ tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: 302 }} />
                {columns.map(({ agent: a }) => (
                  <col key={a.agent_id} style={{ width: `calc((100% - 302px) / ${columns.length})` }} />
                ))}
              </colgroup>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 bg-souk-surface1 border-b border-r border-souk-hair text-left"
                      style={{ padding: '16px 14px 14px 14px' }}
                    >
                      <Txt size={13} lead={18} weight="bold" tone="ink">
                        Fact
                      </Txt>
                    </th>
                    {columns.map(({ agent: a, category }) => {
                      const best = winnerIds.has(a.agent_id)
                      const checked = checkedIds.includes(a.agent_id)
                      return (
                        <th
                          key={a.agent_id}
                          scope="col"
                          className="border-b border-r border-souk-hair text-left font-normal"
                          style={{ padding: '16px 14px 14px 14px' }}
                        >
                          <Row align="center" gap={11}>
                            <AgentAvatar size={34} name={a.name} imageUrl={a.image_url} />
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <Link
                                  to={`/agents/${a.chain_id}/${a.token_id}`}
                                  className="text-[16px] font-bold leading-[22px] text-souk-ink transition hover:text-souk-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                                >
                                  {a.name}
                                </Link>
                                {best ? (
                                  <span title={`Best in ${category.toLowerCase()} per the shelf's order: last check, then registry score, then reviews`}>
                                    <IconTrophy />
                                  </span>
                                ) : null}
                              </span>
                              <Txt size={11} lead={15} mono tone="labels" className="block">
                                {chainLabel(a.chain_id)} · #{a.token_id}
                              </Txt>
                            </span>
                          </Row>
                          <Row align="center" gap={6} pad={[8, 0, 0, 0]} className="flex-wrap">
                            <Pill variant="off">{category}</Pill>
                            {railsFor(a).map((rail) => (
                              <Pill key={rail} variant="off">
                                {rail}
                              </Pill>
                            ))}
                          </Row>
                          {sellsByJob(a.skills) ? (
                            <Txt size={12} lead={17} tone="steel" className="mt-2 block">
                              <span title={JOB_SELLER_NOTE}>Hired by ERC-8183 job, not here</span>
                            </Txt>
                          ) : (
                            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] leading-[17px] text-souk-steel">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggleChecked(a.agent_id)}
                                className="h-4 w-4 accent-souk-data"
                              />
                              Include in hire
                            </label>
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-souk-surface1 border-b border-r border-souk-edge text-left align-middle"
                        style={{ padding: '8px 14px 8px 14px' }}
                      >
                        <Txt size={11} lead={16} weight="bold" upper tone="steel">
                          {r.label}
                        </Txt>
                      </th>
                      {columns.map(({ agent: a }) => (
                        <td
                          key={a.agent_id}
                          className="border-b border-r border-souk-edge align-middle text-souk-ink"
                          style={{ padding: '8px 14px 8px 14px' }}
                        >
                          {r.cell(a)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
          </Stack>

          <Stack gap={12} pad={[20, 0, 0, 0]}>
            <SectionHead title="The check behind each verdict" note={ledgerNote} />
            <Stack surface>
              <div className="overflow-x-auto">
                <DataTable
                  cols={[360, 140, 96, 460, 130, 380, 290]}
                  header={['Agent', 'Verdict', 'Grade', 'Method', 'Response', 'Evidence', 'Expiry']}
                  rows={ledgerRows}
                />
              </div>
            </Stack>
          </Stack>
        </>
      )}
    </div>
  )
}

// the newest verification on the table, or null when none of the agents carries one
function newestVerification(agents: AgentDetail[]): AgentDetail['verification'] | null {
  const withCheck = agents
    .filter((a) => a.verification)
    .sort((a, b) => (a.verification!.checkedAt < b.verification!.checkedAt ? 1 : -1))
  return withCheck[0]?.verification ?? null
}

// the design's honest empty state: the count reads zero and the copy says why
// rather than guessing, because neither loader failure borrows a figure
function CompareEmpty({ failed, onPickAgain }: { failed: boolean; onPickAgain: () => void }) {
  return (
    <Stack gap={12} pad={[24, 0, 0, 0]}>
      <SectionHead title="When a compare cannot load" note="THE HONEST EMPTY STATE" />
      <Stack radius={20} hair gap={12} pad={[40, 22, 40, 22]} className="items-center text-center">
        <Txt size={24} lead={30} mono tone="steel">
          0 agents
        </Txt>
        <Txt size={13} lead={20} tone="steel" className="block max-w-[560px]">
          {failed
            ? 'Could not load those agents. Pick them again.'
            : 'None of those agents could be loaded. They may have left the registry.'}
        </Txt>
        <Btn kind="off" onClick={onPickAgain}>
          Pick them again
        </Btn>
      </Stack>
    </Stack>
  )
}

// one fetch per shortlist, cached by sorted agent ids so re-renders and back-navigation
// never re-call the model; null results are cached too
const commentaryCache = new Map<string, { commentary: string; model: string } | null>()

function CompareCommentary({ agents }: { agents: AgentDetail[] }) {
  const [result, setResult] = useState<{ commentary: string; model: string } | null | undefined>(
    undefined,
  )
  const key = useMemo(() => [...agents].map((a) => a.agent_id).sort().join(','), [agents])

  useEffect(() => {
    const cached = commentaryCache.get(key)
    if (cached !== undefined) {
      setResult(cached)
      return
    }
    let cancelled = false
    setResult(undefined)
    // only the numbers the table shows, nothing else leaves the page
    const payload = {
      agents: agents.map((a) => ({
        name: a.name,
        category: categoryOf(a),
        score: a.total_score,
        feedbacks: a.total_feedbacks,
        verified: a.is_verified,
        verification: a.verification
          ? {
              status: a.verification.status,
              quality: a.verification.quality
                ? {
                    grade: a.verification.quality.grade,
                    reason: a.verification.quality.reason,
                  }
                : undefined,
            }
          : undefined,
        pcs: a.pcs,
      })),
      winners: Object.entries(bestByCategory(agents))
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([category, id]) => ({
          category,
          name: agents.find((a) => a.agent_id === id)?.name ?? '',
        }))
        .filter((w) => w.name !== ''),
      language: 'en',
    }
    getCompareCommentary(payload).then((r) => {
      commentaryCache.set(key, r)
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [agents, key])

  if (!result) return null
  return (
    <NoteBox title={`AI commentary · ${result.model}`} className="mt-6">
      <Txt size={13} lead={20} tone="slate" className="block">
        {result.commentary}
      </Txt>
    </NoteBox>
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
  // the filter chip is the design's pill, made clickable: keep when it is the active filter
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 cursor-pointer rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Pill variant={active ? 'keep' : 'off'}>{children}</Pill>
    </button>
  )
}

function ShortlistSearch({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    getAgents({ q, limit: 6 })
      .then((r) => {
        if (!cancelled) setResults(r.items)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q])

  return (
    <div>
      <SectionHead title="Add another agent" />
      <Row align="center" gap={12} radius={8} bg="surface2" hair pad={[0, 6, 0, 18]} className="mt-3 h-11 w-full max-w-[540px]">
        <label className="sr-only" htmlFor="compare-add-search">
          Add another agent
        </label>
        <input
          id="compare-add-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, endpoint or tag"
          className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
        />
      </Row>

      {q.trim() ? (
        loading ? (
          <div className="mt-4 animate-pulse space-y-2" role="status" aria-label="Loading search results">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-10 rounded-[8px] bg-souk-surface2" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Txt size={13} lead={18} tone="muted" className="mt-4 block px-1">
            Nothing matches that search.
          </Txt>
        ) : (
          <Stack hair radius={14} className="mt-4 overflow-hidden">
            {results.map((a) => {
              const key = `${a.chain_id}/${a.token_id}`
              const checked = selected.includes(key)
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-4 border-b border-souk-edge px-4 py-2.5 transition last:border-b-0 focus-within:bg-souk-data/10 ${
                    checked ? 'bg-souk-data/10' : 'hover:bg-souk-surface2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(key)}
                    aria-label={`Compare ${a.name}`}
                    className="h-3.5 w-3.5 accent-souk-data"
                  />
                  <AgentAvatar size={28} name={a.name} imageUrl={a.image_url} />
                  <Txt size={14} lead={20} weight="semibold" tone="ink" className="min-w-0 flex-1 block truncate">
                    {a.name}
                  </Txt>
                  <VerdictInline agent={a} />
                </label>
              )
            })}
          </Stack>
        )
      ) : null}
    </div>
  )
}

function VerdictInline({ agent }: { agent: AgentSummary }) {
  const v = verdictFor(agent.chain_id, agent.verification)
  return (
    <span className="flex shrink-0 items-center gap-2 text-[13px] leading-[19px] text-souk-slate" title={v.explain}>
      <Dot tone={VERDICT_TONE[v.tone]} size={8} />
      {v.label}
    </span>
  )
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}
