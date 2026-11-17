import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, sellsByJob, takesJobs, takesVault } from '@agora/core'
import type { AgentDetail, AgentSummary } from '../core/types'
import { getAgentDetail, getAgents } from '../lib/api'
import { explorerTxBase } from '../lib/contracts'
import { defaultAvatarFor } from '../lib/default-avatar'
import { isOperatedByAgentSouk } from '../lib/first-party'
import { timeAgo, useProofFeed, type FeedItem } from '../lib/proof-feed'
import { hasMark } from '../pages/MarketplacePage'
import { ReceiptsList } from './ReceiptsList'

type SortKey = 'ours' | 'fastest' | 'active' | 'reviews'
type Tab = 'activity' | 'record' | 'about'

function payMode(a: AgentSummary): string {
  if (takesVault(a.skills)) return 'Vault'
  if (sellsByJob(a.skills) || takesJobs(a.skills)) return 'On delivery'
  return 'Per answer'
}

function priceOf(a: AgentSummary): string {
  const declared = (a.skills ?? [])
    .map((s) => (s as { price?: unknown }).price)
    .find((p): p is string => typeof p === 'string' && p.trim().length > 0)
  if (declared) return declared.split(/\s+or\s+|,/)[0]!.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return takesJobs(a.skills) ? 'Quote' : 'At hire'
}

function answering(a: AgentSummary): boolean {
  const s = (a.verification?.status ?? '').toLowerCase()
  return s === 'online' || s === 'delivered'
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}

const HEAD = 'font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels'

// the market view: every agent as a row on a board, the chosen one in the middle, its ticket on
// the right and the tape of confirmed actions underneath. it reads the same sources as the shelf
export function MarketTerminal({ chainId }: { chainId: number }) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [category, setCategory] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('ours')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [tab, setTab] = useState<Tab>('activity')
  const tape = useProofFeed(40)
  const agentFeed = useProofFeed(20, selected ?? undefined)
  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    getAgents({ limit: 100 })
      .then((r) => {
        if (!alive) return
        const seen = new Set<string>()
        const all = [...(r.featured ?? []), ...r.items].filter((a) => {
          const k = `${a.chain_id}/${a.token_id}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        setAgents(all)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  // the newest confirmed action per agent, read off the tape
  const lastAction = useMemo(() => {
    const m = new Map<string, FeedItem>()
    for (const item of tape.items ?? []) if (item.tokenId && !m.has(item.tokenId)) m.set(item.tokenId, item)
    return m
  }, [tape.items])

  const rows = useMemo(() => {
    const list = (agents ?? []).filter((a) => category === 'all' || a.category === category)
    const ours = (a: AgentSummary) => (isOperatedByAgentSouk(a.owner_address) ? 0 : hasMark(a) ? 1 : 2)
    const ms = (a: AgentSummary) => (a.verification?.responseMs && a.verification.responseMs > 0 ? a.verification.responseMs : 1e9)
    const last = (a: AgentSummary) => -Date.parse(lastAction.get(String(a.token_id))?.at ?? '1970-01-01')
    return [...list].sort((a, b) => {
      if (sort === 'fastest') return ms(a) - ms(b)
      if (sort === 'active') return last(a) - last(b)
      if (sort === 'reviews') return b.total_feedbacks - a.total_feedbacks
      return ours(a) - ours(b) || Number(answering(b)) - Number(answering(a))
    })
  }, [agents, category, sort, lastAction])

  useEffect(() => {
    if (!selected && rows.length > 0) setSelected(String(rows[0]!.token_id))
  }, [rows, selected])

  useEffect(() => {
    if (!selected) return
    let alive = true
    setDetail(null)
    getAgentDetail(String(chainId), selected)
      .then((d) => alive && setDetail(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [chainId, selected])

  const explorer = explorerTxBase(chainId)
  const current = rows.find((a) => String(a.token_id) === selected) ?? null
  const vault = current ? takesVault(current.skills) : false

  function onBoardKey(e: KeyboardEvent<HTMLDivElement>) {
    if (rows.length === 0) return
    const i = Math.max(0, rows.findIndex((a) => String(a.token_id) === selected))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]!
      setSelected(String(next.token_id))
      boardRef.current?.querySelector(`[data-token="${next.token_id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }

  if (failed) return <p className="mt-6 text-[14px] text-souk-slate">The market could not be read just now.</p>
  if (!agents) {
    return (
      <div className="mt-6 grid animate-pulse gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_320px]" role="status" aria-label="Loading the market">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[520px] rounded-[14px] bg-souk-surface2" />
        ))}
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_300px]">
        {/* the board */}
        <section className="min-w-0 rounded-[14px] border border-souk-hair bg-souk-surface1/60" aria-label="Agents">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-souk-hair p-2.5">
            {[{ key: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ key: c.key, label: c.label }))].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                aria-pressed={category === c.key}
                className={`rounded-[7px] px-2 py-1 text-[11px] font-semibold transition-colors ${category === c.key ? 'bg-souk-surface2 text-souk-ink' : 'text-souk-steel hover:text-souk-ink'}`}
              >
                {c.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-souk-steel">
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-[6px] border border-souk-hair bg-souk-canvas px-1.5 py-1 text-[11px] text-souk-ink">
                <option value="ours">Ours, then verified</option>
                <option value="active">Last on chain</option>
                <option value="fastest">Fastest answer</option>
                <option value="reviews">Most reviewed</option>
              </select>
            </label>
          </div>
          <div className={`grid grid-cols-[minmax(0,1fr)_74px_58px] sm:grid-cols-[minmax(0,1fr)_76px_64px_70px] gap-2 px-3 py-2 ${HEAD}`}>
            <span>Agent</span>
            <span>Pays</span>
            <span className="hidden text-right sm:block">Answer</span>
            <span className="text-right">On chain</span>
          </div>
          <div
            ref={boardRef}
            tabIndex={0}
            onKeyDown={onBoardKey}
            role="listbox"
            aria-label="Agents, use the arrow keys to move"
            aria-activedescendant={selected ? `mk-${selected}` : undefined}
            className="max-h-[360px] overflow-y-auto sm:max-h-[560px] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-souk-data"
          >
            {rows.map((a) => {
              const id = String(a.token_id)
              const on = id === selected
              const last = lastAction.get(id)
              return (
                <button
                  key={id}
                  id={`mk-${id}`}
                  data-token={id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => setSelected(id)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_74px_58px] sm:grid-cols-[minmax(0,1fr)_76px_64px_70px] items-center gap-2 border-t border-souk-hair/60 px-3 py-2 text-left transition-colors ${on ? 'bg-souk-surface2' : 'hover:bg-souk-surface2/50'}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${answering(a) ? 'bg-souk-good' : 'bg-souk-warn'}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-souk-ink">{a.name}</span>
                      <span className="block truncate text-[11px] text-souk-labels">
                        {hasMark(a) ? <span className="mr-1.5 font-semibold text-souk-good">Verified</span> : null}
                        {categoryName(a.category)}
                      </span>
                    </span>
                  </span>
                  <span className="truncate text-[11px] text-souk-slate">{payMode(a)}</span>
                  <span className="hidden text-right font-mono text-[11px] text-souk-slate sm:block">
                    {a.verification?.responseMs ? `${a.verification.responseMs}ms` : 'n/a'}
                  </span>
                  <span className="text-right font-mono text-[11px] text-souk-slate">{last ? timeAgo(last.at) : 'none'}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* the selected agent */}
        <section className="min-w-0 rounded-[14px] border border-souk-hair bg-souk-surface1/60" aria-label="Selected agent">
          {current ? (
            <>
              <div className="flex items-start gap-3 border-b border-souk-hair p-4">
                <img
                  src={current.image_url ?? defaultAvatarFor(current.chain_id, String(current.token_id))}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-[10px] border border-souk-hair object-cover"
                  onError={(e) => {
                    e.currentTarget.src = defaultAvatarFor(current.chain_id, String(current.token_id))
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h2 className="truncate text-[18px] font-bold text-souk-ink">{current.name}</h2>
                    <span className="font-mono text-[11px] text-souk-labels">#{current.token_id}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-souk-steel sm:grid-cols-4">
                    <span>{answering(current) ? 'Answering' : 'Not answering'}</span>
                    <span>{current.verification?.responseMs ? `${current.verification.responseMs} ms` : 'no reading'}</span>
                    <span>{current.total_feedbacks} reviews</span>
                    <span>{hasMark(current) ? 'Verified' : 'Not verified'}</span>
                  </div>
                </div>
              </div>
              <div role="tablist" aria-label="About this agent" className="flex gap-1 border-b border-souk-hair px-3">
                {(['activity', 'record', 'about'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-2.5 py-2 text-[12px] font-semibold capitalize ${tab === t ? 'border-souk-accent text-souk-ink' : 'border-transparent text-souk-steel hover:text-souk-ink'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="max-h-[470px] overflow-y-auto p-4">
                {tab === 'activity' ? (
                  <div className="space-y-4">
                    {agentFeed.items === null ? (
                      <p className="text-[13px] text-souk-steel">Reading its record.</p>
                    ) : agentFeed.items.length === 0 ? (
                      <p className="text-[13px] text-souk-steel">Nothing confirmed on chain yet.</p>
                    ) : (
                      <ul className="divide-y divide-souk-hair border-y border-souk-hair">
                        {agentFeed.items.slice(0, 12).map((item) => (
                          <li key={item.txHash + item.kind}>
                            <a
                              href={`${explorer}/tx/${item.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2.5 hover:bg-souk-surface2/50"
                            >
                              <span className="truncate text-[13px] text-souk-ink">{item.detail}</span>
                              <span className="text-right font-mono text-[12px] text-souk-ink">
                                {item.amount ? `${item.amount} ${item.symbol ?? ''}` : ''}
                              </span>
                              <span className="font-mono text-[11px] text-souk-labels">{timeAgo(item.at)}</span>
                              <span className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-souk-sky">Transaction</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    {vault && detail?.agent_wallet ? <ReceiptsList agent={detail.agent_wallet} chainId={chainId} /> : null}
                  </div>
                ) : tab === 'record' ? (
                  <dl className="grid grid-cols-2 gap-3 text-[13px]">
                    {[
                      ['Registry score', current.total_score > 0 ? current.total_score.toFixed(1) : 'n/a'],
                      ['Reviews', String(current.total_feedbacks)],
                      ['Last check', current.verification?.checkedAt ? timeAgo(current.verification.checkedAt) : 'never'],
                      ['Listed', new Date(current.created_at).toLocaleDateString()],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-[10px] border border-souk-hair p-3">
                        <dt className={HEAD}>{k}</dt>
                        <dd className="mt-1 text-souk-ink">{v}</dd>
                      </div>
                    ))}
                    <div className="col-span-2 text-[12px] text-souk-steel">
                      Jobs delivered, repeat buyers and quotes for the same task are on{' '}
                      <Link to={`/compare?agent=${chainId}/${current.token_id}`} className="text-souk-sky hover:underline">
                        its compare page
                      </Link>
                      .
                    </div>
                  </dl>
                ) : (
                  <div className="space-y-3 text-[13px] leading-[20px] text-souk-slate">
                    <p>{current.description || 'No description on its registration.'}</p>
                    {(current.skills ?? []).length > 0 ? (
                      <ul className="space-y-1">
                        {(current.skills ?? []).slice(0, 6).map((s, i) => (
                          <li key={i} className="text-souk-ink">
                            {(s as { name?: string }).name ?? (s as { id?: string }).id ?? 'Skill'}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Link to={`/agents/${chainId}/${current.token_id}`} className="inline-block text-souk-sky hover:underline">
                      Open the full agent page
                    </Link>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="p-4 text-[13px] text-souk-slate">No agent in this category.</p>
          )}
        </section>

        {/* the ticket */}
        <aside className="min-w-0 rounded-[14px] border border-souk-hair bg-souk-surface1/60 p-4" aria-label="Hire">
          {current ? (
            <div className="space-y-4">
              <div className={HEAD}>Ticket</div>
              <div>
                <div className="text-[12px] text-souk-steel">How you pay</div>
                <div className="mt-0.5 text-[15px] font-semibold text-souk-ink">
                  {vault ? 'Your money stays in a vault' : payMode(current) === 'On delivery' ? 'Pay on delivery' : 'Pay per answer'}
                </div>
              </div>
              <div>
                <div className="text-[12px] text-souk-steel">Price</div>
                <div className="mt-0.5 font-mono text-[15px] text-souk-ink">{priceOf(current)}</div>
              </div>
              {vault ? (
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  {[
                    ['Pair', 'WBNB / USDT'],
                    ['Minimum', typeof (detail as { vaultMinDepositUsd?: number } | null)?.vaultMinDepositUsd === 'number' ? `$${(detail as { vaultMinDepositUsd?: number }).vaultMinDepositUsd}` : 'n/a'],
                    ['Agent fee', '0%, waived'],
                    ['Loss cap', 'You set it'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[8px] border border-souk-hair p-2">
                      <dt className="text-[10px] uppercase tracking-[0.06em] text-souk-labels">{k}</dt>
                      <dd className="mt-0.5 text-souk-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <Link
                to={`/agents/${chainId}/${current.token_id}`}
                className="block rounded-[10px] bg-souk-accent px-4 py-2.5 text-center text-[13px] font-semibold text-souk-on-accent transition hover:bg-souk-accent-hover"
              >
                Hire {current.name}
              </Link>
              <p className="text-[11px] leading-[16px] text-souk-labels">Opens its hire box. Nothing moves until you confirm in your wallet.</p>
            </div>
          ) : null}
        </aside>
      </div>

      {/* the tape */}
      <section className="mt-3 overflow-hidden rounded-[14px] border border-souk-hair bg-souk-surface1/60" aria-label="Confirmed on chain">
        <div className="flex items-center gap-4 overflow-x-auto px-4 py-2.5 [scrollbar-width:thin]">
          <span className={`${HEAD} shrink-0 text-souk-data`}>On chain</span>
          {(tape.items ?? []).slice(0, 20).map((item) => (
            <a
              key={item.txHash + item.kind}
              href={`${explorer}/tx/${item.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-2 text-[12px] text-souk-slate hover:text-souk-ink"
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${item.kind === 'trade' ? 'bg-souk-data' : 'bg-souk-good'}`} />
              <span className="font-semibold text-souk-ink">{item.agentName}</span>
              <span>{item.detail.toLowerCase()}</span>
              {item.amount ? <span className="font-mono">{item.amount} {item.symbol ?? ''}</span> : null}
              <span className="font-mono text-souk-labels">{timeAgo(item.at)}</span>
            </a>
          ))}
          {tape.items && tape.items.length === 0 ? <span className="text-[12px] text-souk-steel">Nothing confirmed yet.</span> : null}
        </div>
      </section>
    </div>
  )
}
