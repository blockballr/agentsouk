import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentDetail, AgentSummary } from '@agora/core'
import { CATEGORIES, formatNumber, formatScore, shortAddress } from '@agora/core'
import { getAgentDetail, getAgents } from '../lib/api'
import { bestByCategory, categoryGroups } from '../lib/compare'
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

  function toggleId(id: string) {
    const next = urlIds.includes(id) ? urlIds.filter((x) => x !== id) : [...urlIds, id]
    persistShortlist(next)
    const nextSp = new URLSearchParams()
    if (next.length > 0) nextSp.set('ids', next.join(','))
    setSp(nextSp, { replace: true })
  }

  function clearSelection() {
    persistShortlist([])
    setSp(new URLSearchParams(), { replace: true })
  }

  // same floating bar as the marketplace; here the action anchors the table
  // instead of navigating
  function scrollToTable() {
    document.getElementById('compare-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [agents, setAgents] = useState<AgentDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    if (urlIds.length > 0) {
      const fetchKey = (id: string) => {
        const [chainId = '56', tokenId = id] = id.split('/')
        return getAgentDetail(chainId, tokenId)
      }
      Promise.all(urlIds.map(fetchKey))
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
  }, [urlIds.join(',')])

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Compare</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Side by side.
      </h1>

      {urlIds.length === 0 ? (
        <Picker />
      ) : (
        <>
          <CompareTable agents={agents} loading={loading} error={error} onClear={clearSelection} />
          <ShortlistSearch selected={urlIds} onToggle={toggleId} />
          {urlIds.length >= 2 && (
            <CompareBar count={urlIds.length} onClear={clearSelection} onCompare={scrollToTable} />
          )}
        </>
      )}
    </section>
  )
}

function Picker() {
  const [, setSp] = useSearchParams()
  const [category, setCategory] = useState<string>('all')
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<AgentSummary[]>([])
  const [selected, setSelected] = useState<string[]>(() => getShortlist())
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
    setSelected(toggleShortlist(id))
  }

  function clearSelection() {
    setSelected([])
    persistShortlist([])
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
          className="hairline w-56 border-slate-verdant/25 bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
        />
      </div>

      <div className="mt-6 flex items-center gap-6 text-xs text-newsprint-gray">
        <span>
          {selected.length > 0 ? `${selected.length} shortlisted` : 'Nothing shortlisted yet'}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clearSelection}
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
        <ul className="mt-8 border hairline border-slate-verdant/20">
          {options.map((a) => {
            const key = keyFor(a)
            const checked = selected.includes(key)
            return (
              <li key={key}>
                <label
                  className={`flex cursor-pointer items-center gap-6 border-b hairline border-slate-verdant/20 px-6 py-5 transition last:border-b-0 ${
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

      <div className="mt-10 flex items-center gap-6">
        <button
          type="button"
          disabled={selected.length < 2}
          onClick={() => {
            setSp({ ids: selected.join(',') }, { replace: true })
          }}
          className="micro rounded-[5px] bg-highlighter-green px-6 py-5 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Compare {selected.length > 0 ? selected.length : ''} agents
        </button>
        <p className="text-xs text-newsprint-gray">
          Pick at least two to build the table.
        </p>
      </div>
    </div>
  )
}

function CompareTable({
  agents,
  loading,
  error,
  onClear,
}: {
  agents: AgentDetail[]
  loading: boolean
  error: boolean
  onClear: () => void
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
        <p className="border hairline border-slate-verdant/20 px-10 py-16 text-center text-sm text-newsprint-gray">
          Could not load the selected agents. Go back and pick again.
        </p>
      ) : loading ? (
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading comparison">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-14 bg-slate-verdant/10" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="border hairline border-slate-verdant/20 px-10 py-16 text-center text-sm text-newsprint-gray">
          None of those agents could be loaded. They may have left the registry.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="border-b hairline border-slate-verdant/20" scope="col" aria-label="Metric" />
                {groups.map((g) => {
                  const winnerId = winnerByCategory[g.category] ?? null
                  const winner = winnerId ? agents.find((a) => a.agent_id === winnerId) : null
                  return (
                    <th
                      key={g.category}
                      colSpan={g.agents.length}
                      className={`micro border-b hairline border-slate-verdant/20 px-4 py-3 text-newsprint-gray ${
                        winner ? 'bg-highlighter-green/15 text-highlighter-green' : ''
                      }`}
                      scope="colgroup"
                    >
                      {g.label}
                      {winner && <span className="ml-3 font-normal normal-case">best: {winner.name}</span>}
                    </th>
                  )
                })}
              </tr>
              <tr>
                <th className="micro border-b hairline border-slate-verdant/20 p-4 text-newsprint-gray" scope="col">
                  Metric
                </th>
                {ordered.map((a) => {
                  const winner = winnerIds.has(a.agent_id)
                  const separator = groupStartIds.has(a.agent_id) ? 'border-l border-l-slate-verdant/20' : ''
                  return (
                    <th
                      key={a.agent_id}
                      className={`border-b hairline border-slate-verdant/20 p-4 font-serif text-lg font-medium ${separator} ${
                        winner ? 'bg-highlighter-green/15' : ''
                      }`}
                      scope="col"
                    >
                      <Link to={`/agents/${a.chain_id}/${a.token_id}`} className="hover:text-highlighter-green focus-visible:outline-2 focus-visible:outline-highlighter-green">
                        {a.name}
                      </Link>
                      {winner && (
                        <span className="micro mt-2 block rounded-full border hairline border-highlighter-green/50 px-2.5 py-1 text-highlighter-green">
                          best in category
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
                  <th scope="row" className="micro border-b hairline border-slate-verdant/20 p-4 text-newsprint-gray">
                    {row.label}
                  </th>
                  {ordered.map((a) => (
                    <td
                      key={a.agent_id}
                      className={`border-b hairline border-slate-verdant/20 p-4 text-sm text-press-black ${
                        groupStartIds.has(a.agent_id) ? 'border-l border-l-slate-verdant/20' : ''
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
          className="hairline w-56 border-slate-verdant/25 bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
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
          <p className="mt-4 border hairline border-slate-verdant/20 px-6 py-6 text-sm text-newsprint-gray">
            Nothing matches that search.
          </p>
        ) : (
          <ul className="mt-4 border hairline border-slate-verdant/20">
            {results.map((a) => {
              const key = `${a.chain_id}/${a.token_id}`
              const checked = selected.includes(key)
              return (
                <li key={key}>
                  <label
                    className={`flex cursor-pointer items-center gap-4 border-b hairline border-slate-verdant/20 px-4 py-2.5 transition last:border-b-0 ${
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