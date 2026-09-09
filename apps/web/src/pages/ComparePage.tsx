import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentDetail, AgentSummary } from '@agora/core'
import { CATEGORIES, formatNumber, formatScore, shortAddress } from '@agora/core'
import { getAgentDetail, getAgents, getCompareCommentary } from '../lib/api'
import { bestByCategory, categoryGroups, categoryOf } from '../lib/compare'
import { CompareBar } from '../components/CompareBar'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'

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

  // selecting agents must never swap the view or navigate: the table renders
  // only from url ids, i.e. after an explicit Compare click on the floating
  // bar. the picker stays put so multi-select across categories keeps working
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

  // per-agent hire selection over the current table agents; the best of each
  // category starts checked, any row can be toggled. the bar's count always
  // equals this selection, so it can never go stale
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // re-sync on every (re)load of the compared set: selection becomes the
  // bests of the freshly loaded agents, or the whole set when no bests are
  // derivable (single agent); stale selections from an earlier compare die here
  useEffect(() => {
    if (agents.length === 0) return
    const winners = Object.values(bestByCategory(agents)).filter((id): id is string => id !== null)
    setSelectedIds(winners.length > 0 ? winners : agents.map((a) => a.agent_id))
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

  // the loaded agents must BE the current shortlist before the bar may quote
  // a hire count; during a refetch (or with leftover agents from an earlier
  // compare) the selection is stale, so the bar shows no hire button instead
  // of an incoherent one
  const agentsMatchShortlist = useMemo(
    () =>
      agents.length > 0 &&
      agents.length === effectiveIds.length &&
      agents.every((a) => effectiveIds.includes(a.agent_id)),
    [agents, effectiveIds],
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
        // hire only in table mode: the selection counts current table agents,
        // so a stale set from a previous comparison can never leak into the
        // button (picker mode shows no hire button, matching the marketplace)
        hire={
          effectiveIds.length > 0 && agentsMatchShortlist ? { winners: selectedAgents } : undefined
        }
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
      <p className="micro text-newsprint-gray">
        Shortlist agents. Selections carry across filters, so you can match any
        mix of categories.
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
        <label className="micro text-newsprint-gray" htmlFor="compare-search">
          Search
        </label>
        <input
          id="compare-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, endpoint, tag"
          className="hairline input-hairline w-56 bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
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
        <ul className="mt-8 border hairline border-slate-verdant/40">
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
                    <span className="mt-0.5 block text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
                      {a.category} · {shortAddress(a.owner_address)}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-newsprint-gray">
                    {formatScore(a.total_score)}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-10 text-xs text-newsprint-gray">
        Pick at least two to build the table — the floating bar takes over
        from there.
      </p>
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
  const winnerByCategory = useMemo(() => bestByCategory(agents), [agents])
  const winnerIds = useMemo(
    () => new Set(Object.values(winnerByCategory).filter((id): id is string => id !== null)),
    [winnerByCategory],
  )
  const groups = useMemo(() => categoryGroups(agents), [agents])
  const ordered = useMemo(() => groups.flatMap((g) => g.agents), [groups])
  // left-edge separators so each category band's columns read as one section
  const groupStartIds = useMemo(
    () => new Set(groups.slice(1).map((g) => g.agents[0]?.agent_id).filter((id): id is string => id !== undefined)),
    [groups],
  )

  const rows = useMemo(
    () => [
      { label: 'Owner', render: (a: AgentDetail) => shortAddress(a.owner_address) },
      { label: 'Score', render: (a: AgentDetail) => formatScore(a.total_score) },
      { label: 'Avg feedback', render: (a: AgentDetail) => formatScore(a.average_score) },
      { label: 'Hires', render: (a: AgentDetail) => formatNumber(a.total_feedbacks) },
      { label: 'Health', render: (a: AgentDetail) => (a.health_score !== null ? formatScore(a.health_score) : '—') },
      { label: 'Verified', render: (a: AgentDetail) => (a.is_verified ? 'yes' : 'no') },
      { label: 'x402', render: (a: AgentDetail) => (a.x402_supported ? 'yes' : 'no') },
      {
        label: 'A2A endpoint',
        render: (a: AgentDetail) =>
          a.a2a_endpoint ? (
            <a href={a.a2a_endpoint} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-press-black hover:text-highlighter-green">
              {a.a2a_endpoint}
            </a>
          ) : (
            '—'
          ),
      },
    ],
    [],
  )

  return (
    <div id="compare-table" className="mt-12 scroll-mt-8">
      <div className="mb-8 flex items-center justify-between">
        <p className="micro text-newsprint-gray">
          {agents.length} of {agents.length} loaded
        </p>
        <button
          type="button"
          onClick={onClear}
          className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
        >
          Clear selection
        </button>
      </div>

      {error ? (
        <p className="border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          Could not load the selected agents. Go back and pick again.
        </p>
      ) : loading ? (
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading comparison">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-14 bg-slate-verdant/10" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          None of those agents could be loaded. They may have left the registry.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="border-b hairline border-slate-verdant/40" scope="col" aria-label="Metric" />
                {groups.map((g) => {
                  const winnerId = winnerByCategory[g.category] ?? null
                  const winner = winnerId ? agents.find((a) => a.agent_id === winnerId) : null
                  return (
                    <th
                      key={g.category}
                      colSpan={g.agents.length}
                      className={`micro border-b hairline border-slate-verdant/40 px-4 py-3 text-newsprint-gray ${
                        winner ? 'bg-highlighter-green/15 text-highlighter-green' : ''
                      }`}
                      scope="colgroup"
                    >
                      {g.label}
                      {winner && (
                        <span className="micro ml-3 inline-flex items-center gap-1.5 rounded-full border hairline border-highlighter-green/50 bg-highlighter-green/10 px-2.5 py-1 font-normal normal-case text-highlighter-green">
                          <TrophyIcon className="h-3 w-3" />
                          {winner.name}
                          <span className="sr-only">best in category</span>
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
              <tr>
                <th className="micro border-b hairline border-slate-verdant/40 p-4 text-newsprint-gray" scope="col">
                  Metric
                </th>
                {ordered.map((a) => {
                  const winner = winnerIds.has(a.agent_id)
                  const separator = groupStartIds.has(a.agent_id) ? 'border-l border-l-slate-verdant/40' : ''
                  return (
                    <th
                      key={a.agent_id}
                      className={`border-b hairline border-slate-verdant/40 p-4 font-serif text-lg font-medium ${separator} ${
                        winner ? 'bg-highlighter-green/15' : ''
                      }`}
                      scope="col"
                    >
                      {/* per-agent hire selection; the winner is pre-checked */}
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(a.agent_id)}
                        onChange={() => onToggleChecked(a.agent_id)}
                        aria-label={`Hire ${a.name}`}
                        title="Hire this agent"
                        className="mr-2 h-3.5 w-3.5 shrink-0 translate-y-[-1px] accent-highlighter-green"
                      />
                      <Link to={`/agents/${a.chain_id}/${a.token_id}`} className="hover:text-highlighter-green focus-visible:outline-2 focus-visible:outline-highlighter-green">
                        {a.name}
                      </Link>
                      {winner && (
                        <span
                          aria-label="best in category"
                          className="mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full border hairline border-highlighter-green/50 bg-highlighter-green/10 text-highlighter-green"
                        >
                          <TrophyIcon />
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="micro border-b hairline border-slate-verdant/40 p-4 text-newsprint-gray">
                    {row.label}
                  </th>
                  {ordered.map((a) => (
                    <td
                      key={a.agent_id}
                      className={`border-b hairline border-slate-verdant/40 p-4 text-sm text-press-black ${
                        groupStartIds.has(a.agent_id) ? 'border-l border-l-slate-verdant/40' : ''
                      } ${winnerIds.has(a.agent_id) ? 'bg-highlighter-green/15' : ''}`}
                    >
                      {row.render(a)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-newsprint-gray">
            Best in category is highlighted, ranked by on-chain score, then
            feedback, then delivery.
          </p>
        </div>
      )}
    </div>
  )
}

// one fetch per shortlist, cached by sorted agent ids so re-renders and
// back-navigation never re-call the model; null results are cached too so a
// failed commentary stays hidden instead of retrying on every keystroke
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
        <p className="micro text-newsprint-gray">Add more agents</p>
        <label className="micro text-newsprint-gray" htmlFor="compare-add-search">
          Search
        </label>
        <input
          id="compare-add-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, endpoint, tag"
          className="hairline input-hairline w-56 bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
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
                    <span className="micro text-newsprint-gray">
                      {a.category}
                    </span>
                    <span className="text-sm tabular-nums text-newsprint-gray">
                      {formatScore(a.total_score)}
                    </span>
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