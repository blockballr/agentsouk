import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentDetail, AgentSummary } from '@agora/core'
import {
  CATEGORIES,
  JOB_SELLER_NOTE,
  formatNumber,
  formatScore,
  isJobStepSkill,
  sellsByJob,
  shortAddress,
  timeAgo,
} from '@agora/core'
import { getAgentDetail, getAgents, getCompareCommentary } from '../lib/api'
import { bestByCategory, categoryGroups, categoryOf } from '../lib/compare'
import { CompareBar } from '../components/CompareBar'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'
import { OPERATED_BY_LABEL, OPERATED_BY_TITLE, isOperatedByAgentSouk } from '../lib/first-party'
import { builtWithFrom } from '../lib/onchain-meta'
import { VERDICT_DOT, verdictFor } from '../lib/verdict'
import { card, cx } from '../components/ui'

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

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Compare</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Side by side.
      </h1>

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
          <ShortlistSearch selected={effectiveIds} onToggle={toggleId} />
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
    <div className="mt-12">
      <p className="max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Pick two or more agents to see them side by side. Your picks stay as you switch category.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-6">
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
        <label className="sr-only" htmlFor="compare-search">
          Search agents
        </label>
        <input
          id="compare-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, endpoint or tag"
          className="border hairline input-hairline w-full rounded-[6px] bg-transparent px-3 py-2 text-base sm:w-64 sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
        />
      </div>

      <div className="mt-6 flex items-center gap-6 text-xs text-newsprint-gray">
        <span>
          {selected.length > 0 ? `${selected.length} shortlisted` : 'Nothing shortlisted yet'}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="mt-8 animate-pulse space-y-3" role="status" aria-label="Loading candidates">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 bg-slate-verdant/10" />
          ))}
        </div>
      ) : (
        <ul className={cx(card('plain', 'none'), 'mt-6 overflow-hidden')}>
          {options.map((a) => {
            const key = keyFor(a)
            const checked = selected.includes(key)
            return (
              <li key={key}>
                <label
                  className={`flex cursor-pointer items-center gap-6 border-b hairline border-slate-verdant/40 px-6 py-5 transition last:border-b-0 ${
                    checked ? 'bg-echo-green/40' : 'hover:bg-echo-green/20'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(key)}
                    className="h-4 w-4 accent-highlighter-green"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-lg font-medium">{a.name}</span>
                    <span className="mt-0.5 block text-[12px] text-newsprint-gray">
                      {categoryName(a.category)} ·{' '}
                      {isOperatedByAgentSouk(a.owner_address) ? OPERATED_BY_LABEL : shortAddress(a.owner_address)}
                    </span>
                  </span>
                  <VerdictInline agent={a} />
                </label>
              </li>
            )
          })}
        </ul>
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
  onClear: () => void
  checkedIds: string[]
  onToggleChecked: (id: string) => void
}) {
  const winnerIds = useMemo(
    () => new Set(Object.values(bestByCategory(agents)).filter((id): id is string => id !== null)),
    [agents],
  )
  // columns read by category, the best of each first, so a winner sits beside its rivals
  const columns = useMemo(
    () =>
      categoryGroups(agents).flatMap((g) =>
        [...g.agents]
          .sort((a, b) => Number(winnerIds.has(b.agent_id)) - Number(winnerIds.has(a.agent_id)))
          .map((agent) => ({ agent, category: g.label })),
      ),
    [agents, winnerIds],
  )

  const rows: { label: string; cell: (a: AgentDetail) => ReactNode }[] = [
    {
      label: 'Last check',
      cell: (a) => {
        const v = verdictFor(a.chain_id, a.verification)
        return (
          <span title={v.explain}>
            <span className="flex items-center gap-2 font-medium text-press-black">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[v.tone]}`} />
              {v.label}
            </span>
            {a.verification ? (
              <span className="mt-0.5 block text-[12px] text-newsprint-gray">checked {timeAgo(a.verification.checkedAt)}</span>
            ) : null}
          </span>
        )
      },
    },
    {
      label: 'How you pay',
      // our relay settles a direct hire whatever the agent advertises, so only job sellers differ
      cell: (a) => (sellsByJob(a.skills) ? 'By ERC-8183 job' : 'Per call, x402'),
    },
    {
      label: 'What it does',
      cell: (a) => {
        const names = (a.skills ?? [])
          .filter((s) => !isJobStepSkill(s, a.skills ?? []))
          .map((s) => s.name ?? s.id)
          .filter((n): n is string => Boolean(n))
        if (names.length === 0) return <span className="text-newsprint-gray">{a.description?.slice(0, 90) || 'No skill list'}</span>
        return (
          <ul className="space-y-0.5">
            {names.slice(0, 3).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {names.length > 3 ? <li className="text-newsprint-gray">and {names.length - 3} more</li> : null}
          </ul>
        )
      },
    },
    { label: 'Registry score', cell: (a) => formatScore(a.total_score) },
    { label: 'Reviews', cell: (a) => formatNumber(a.total_feedbacks) },
    { label: 'Health', cell: (a) => (a.health_score !== null ? formatScore(a.health_score) : 'n/a') },
    {
      label: 'Built with',
      cell: (a) => builtWithFrom(a.raw_metadata?.onchain ?? [])?.label ?? <span className="text-newsprint-gray">Not stated</span>,
    },
    {
      label: 'Owner',
      cell: (a) =>
        isOperatedByAgentSouk(a.owner_address) ? (
          <span title={OPERATED_BY_TITLE}>{OPERATED_BY_LABEL}</span>
        ) : (
          <span className="font-mono text-[12px]">{shortAddress(a.owner_address)}</span>
        ),
    },
  ]

  return (
    <div id="compare-table" className="mt-12 scroll-mt-8">
      <div className="mb-4 flex items-center justify-between">
        <p className="micro text-newsprint-gray">{agents.length} agents</p>
        <button
          type="button"
          onClick={onClear}
          className="micro min-h-11 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green sm:min-h-0"
        >
          Start over
        </button>
      </div>

      {error ? (
        <p className="rounded-[14px] border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          Could not load those agents. Pick them again.
        </p>
      ) : loading ? (
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading comparison">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-14 bg-slate-verdant/10" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="rounded-[14px] border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          None of those agents could be loaded. They may have left the registry.
        </p>
      ) : (
        <>
          <div className={cx(card('plain', 'none'), 'overflow-x-auto')}>
            <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-[132px] bg-bone-white p-4 align-bottom sm:w-[160px]">
                    <span className="sr-only">Fact</span>
                  </th>
                  {columns.map(({ agent: a, category }) => {
                    const best = winnerIds.has(a.agent_id)
                    const checked = checkedIds.includes(a.agent_id)
                    return (
                      <th
                        key={a.agent_id}
                        scope="col"
                        className={`min-w-[190px] border-l hairline border-slate-verdant/25 p-4 align-top font-normal ${best ? 'bg-highlighter-green/[0.07]' : ''}`}
                      >
                        <span className="micro block text-newsprint-gray">{category}</span>
                        <Link
                          to={`/agents/${a.chain_id}/${a.token_id}`}
                          className="mt-1 block font-serif text-[19px] font-medium leading-tight text-press-black hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
                        >
                          {a.name}
                        </Link>
                        {best ? (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-press-black px-2 py-0.5 text-[11px] font-[550] text-bone-white">
                            <TrophyIcon className="h-3 w-3" />
                            Best in {category.toLowerCase()}
                          </span>
                        ) : null}
                        {sellsByJob(a.skills) ? (
                          <p className="mt-3 text-[13px] text-newsprint-gray" title={JOB_SELLER_NOTE}>
                            Hired by ERC-8183 job, not here
                          </p>
                        ) : (
                          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-press-black sm:min-h-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleChecked(a.agent_id)}
                              className="h-4 w-4 accent-highlighter-green"
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
                  <tr key={r.label} className="border-t hairline border-slate-verdant/25">
                    <th scope="row" className="micro sticky left-0 z-10 bg-bone-white p-4 align-top font-[550] text-newsprint-gray">
                      {r.label}
                    </th>
                    {columns.map(({ agent: a }) => (
                      <td
                        key={a.agent_id}
                        className={`border-l hairline border-slate-verdant/25 p-4 align-top text-press-black ${winnerIds.has(a.agent_id) ? 'bg-highlighter-green/[0.07]' : ''}`}
                      >
                        {r.cell(a)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-newsprint-gray">
            Best in each category goes to the agent whose last check went best, then the higher
            registry score, then more reviews. The best agent you can hire directly in each category
            starts ticked.
          </p>
        </>
      )}
    </div>
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
    <div className="mt-6 border hairline border-slate-verdant/40 bg-echo-green/20 px-6 py-5">
      <p className="micro text-newsprint-gray">AI commentary · {result.model}</p>
      <p className="mt-3 font-serif text-lg leading-snug text-press-black">{result.commentary}</p>
    </div>
  )
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width="14"
      height="14"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 3h12v2h3v3a5 5 0 0 1-4.58 4.98A6.01 6.01 0 0 1 13 16.92V19h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.08a6.01 6.01 0 0 1-3.42-3.94A5 5 0 0 1 3 8V5h3V3Zm0 4H5v1a3 3 0 0 0 1 2.24V7Zm12 0v3.24A3 3 0 0 0 19 8V7h-1Z" />
    </svg>
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
    <div className="mt-12">
      <div className="flex flex-wrap items-center gap-6">
        <label className="micro text-newsprint-gray" htmlFor="compare-add-search">
          Add another agent
        </label>
        <input
          id="compare-add-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, endpoint or tag"
          className="border hairline input-hairline w-full rounded-[6px] bg-transparent sm:w-64 px-3 py-2 text-base sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
        />
      </div>

      {q.trim() ? (
        loading ? (
          <div className="mt-4 animate-pulse space-y-2" role="status" aria-label="Loading search results">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-10 bg-slate-verdant/10" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="mt-4 border hairline border-slate-verdant/40 px-6 py-6 text-sm text-newsprint-gray">
            Nothing matches that search.
          </p>
        ) : (
          <ul className="mt-4 border hairline border-slate-verdant/40">
            {results.map((a) => {
              const key = `${a.chain_id}/${a.token_id}`
              const checked = selected.includes(key)
              return (
                <li key={key}>
                  <label
                    className={`flex cursor-pointer items-center gap-4 border-b hairline border-slate-verdant/40 px-4 py-2.5 transition last:border-b-0 ${
                      checked ? 'bg-echo-green/40' : 'hover:bg-echo-green/20'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(key)}
                      aria-label={`Compare ${a.name}`}
                      className="h-3.5 w-3.5 accent-highlighter-green"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {a.name}
                    </span>
                    <VerdictInline agent={a} />
                  </label>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </div>
  )
}

function VerdictInline({ agent }: { agent: AgentSummary }) {
  const v = verdictFor(agent.chain_id, agent.verification)
  return (
    <span className="flex shrink-0 items-center gap-2 text-[13px] text-press-black" title={v.explain}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${VERDICT_DOT[v.tone]}`} />
      {v.label}
    </span>
  )
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}
