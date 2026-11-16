import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { defaultAvatarFor } from '../lib/default-avatar'
import { Txt } from './souk'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface PeerRow {
  chainId: number
  tokenId: string
  name: string
  image: string | null
  category: string
  house: boolean
  reach: { ok: boolean; ms: number | null; protocol: string | null; detail: string }
  listedChecks: { passed: number; total: number } | null
  card: { have: number; of: number; missing: string[] }
  price: string | null
  work: {
    total: number
    completed: number
    rejected: number
    expired: number
    inProgress: number
    settled: string
    buyers: number
    repeatBuyers: number
  } | null
  reputation: { score: number | null; feedbacks: number; ageDays: number | null }
  results: { line: string; source: string } | null
}

interface QuoteRow {
  tokenId: string
  ok: boolean
  price: string | null
  reason: string | null
}

interface PeersBody {
  success: boolean
  readAt: string
  jobsIndexedThrough: number
  agents: PeerRow[]
  error?: string
}

const NA = <span className="text-souk-labels">n/a</span>

function units(raw: string): string {
  try {
    const value = Number(BigInt(raw)) / 1e18
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  } catch {
    return '0'
  }
}

// each row: what it measures, where the figure comes from, and one cell per agent
const ROWS: { group: string; label: string; source: string; cell: (a: PeerRow, quote?: QuoteRow) => ReactNode }[] = [
  {
    group: 'Reachable',
    label: 'Answered just now',
    source: 'One call from our server when this page loaded',
    cell: (a) =>
      a.reach.protocol === null ? (
        <span className="text-souk-labels">no public endpoint</span>
      ) : a.reach.ok ? (
        <span>
          Yes, {a.reach.ms} ms <span className="text-souk-labels">({a.reach.protocol})</span>
        </span>
      ) : (
        <span className="text-souk-warn">No, {a.reach.detail}</span>
      ),
  },
  {
    group: 'Reachable',
    label: 'Our checks passed',
    source: 'The marketplace probe history, last 30 checks; only listed agents have one',
    cell: (a) => (a.listedChecks ? `${a.listedChecks.passed} of ${a.listedChecks.total}` : NA),
  },
  {
    group: 'Reachable',
    label: 'Card complete',
    source: 'Description, image, endpoint, skills and wallet in its registration',
    cell: (a) => <span title={a.card.missing.length ? `Missing ${a.card.missing.join(', ')}` : 'Nothing missing'}>{`${a.card.have} of ${a.card.of}`}</span>,
  },
  {
    group: 'Paid work on chain',
    label: 'Jobs delivered and paid',
    source: 'ERC-8183 jobs where its wallet is the provider, read from the job contract',
    cell: (a) => (a.work ? (a.work.total ? `${a.work.completed} of ${a.work.total}` : 'None yet') : NA),
  },
  {
    group: 'Paid work on chain',
    label: 'Rejected or expired',
    source: 'Same jobs: the buyer rejected the delivery, or the job ran out of time',
    cell: (a) => (a.work && a.work.total ? `${a.work.rejected} rejected, ${a.work.expired} expired` : NA),
  },
  {
    group: 'Paid work on chain',
    label: 'Paid out',
    source: 'Sum of the completed jobs, in U',
    cell: (a) => (a.work && a.work.completed ? `${units(a.work.settled)} U` : NA),
  },
  {
    group: 'Paid work on chain',
    label: 'Buyers',
    source: 'Distinct buyer wallets, and how many came back for another completed job',
    cell: (a) => (a.work && a.work.buyers ? `${a.work.buyers}, ${a.work.repeatBuyers} came back` : NA),
  },
  {
    group: 'Results',
    label: 'On record',
    source: 'What we can see it has done: vault receipts, repays, decision logs',
    cell: (a) =>
      a.results ? <span title={a.results.source}>{a.results.line}</span> : <span className="text-souk-labels">not visible to us</span>,
  },
  {
    group: 'Price',
    label: 'Quote for your task',
    source: 'Each agent prices the task above through its own quote step; nothing is paid',
    cell: (_a, q) =>
      !q ? (
        <span className="text-souk-labels">ask above</span>
      ) : q.ok ? (
        <span className="font-semibold text-souk-ink">{q.price}</span>
      ) : (
        <span className="text-souk-labels" title={q.reason ?? undefined}>
          no quote
        </span>
      ),
  },
  {
    group: 'Price',
    label: 'Asks',
    source: 'The price its card declares; many agents quote per job instead',
    cell: (a) => a.price ?? <span className="text-souk-labels">quotes per job</span>,
  },
  {
    group: 'Reputation',
    label: 'Registry score',
    source: 'The ERC-8004 registry index score',
    cell: (a) => (a.reputation.score !== null ? a.reputation.score.toFixed(1) : NA),
  },
  {
    group: 'Reputation',
    label: 'Reviews',
    source: 'Feedback posted to the reputation registry',
    cell: (a) => String(a.reputation.feedbacks),
  },
  {
    group: 'Reputation',
    label: 'Registered',
    source: 'Age of its ERC-8004 identity',
    cell: (a) => (a.reputation.ageDays !== null ? `${a.reputation.ageDays} days ago` : NA),
  },
]

// a task each category's agents can all price, so the quotes are like for like
const DEFAULT_TASK: Record<string, string> = {
  rebalancing: 'Suggest a range for a 500 USDT position in the NVDAB/USDT PancakeSwap V3 pool and say when you would widen it.',
  'grid-trading': 'Plan a 10-rung grid for BNB/USDT between 560 and 640 USDT with 100 USDT.',
  yield: 'Find the best place for 1,000 USDT to earn yield on BNB Chain this week.',
  'health-factor': 'Check a Venus borrowing position and say how much to repay to bring its health factor to 1.5.',
}

export function ComparePeers({ chainId, tokenId }: { chainId: number; tokenId: string }) {
  const [body, setBody] = useState<PeersBody | null>(null)
  const [failed, setFailed] = useState(false)
  const [task, setTask] = useState('')
  const [quotes, setQuotes] = useState<Map<string, QuoteRow> | null>(null)
  const [asking, setAsking] = useState(false)
  const [quoteNote, setQuoteNote] = useState<string | null>(null)

  async function askQuotes(ids: string[], text: string) {
    setAsking(true)
    setQuoteNote(null)
    try {
      const res = await fetch(`${API_BASE}/compare/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chainId, tokenIds: ids, task: text }),
      })
      const b = (await res.json()) as { success: boolean; quotes?: QuoteRow[]; error?: string }
      if (!b.success || !b.quotes) {
        setQuoteNote(b.error ?? 'The quotes could not be read just now.')
        return
      }
      setQuotes(new Map(b.quotes.map((q) => [q.tokenId, q])))
      const got = b.quotes.filter((q) => q.ok).length
      setQuoteNote(`${got} of ${b.quotes.length} agents quoted. Hover "no quote" for the reason.`)
    } catch {
      setQuoteNote('The quotes could not be read just now.')
    } finally {
      setAsking(false)
    }
  }

  useEffect(() => {
    let alive = true
    setBody(null)
    setFailed(false)
    fetch(`${API_BASE}/compare/peers?chainId=${chainId}&tokenId=${encodeURIComponent(tokenId)}`)
      .then((r) => r.json())
      .then((b: PeersBody) => {
        if (!alive) return
        if (b?.success) setBody(b)
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [chainId, tokenId])

  if (failed) {
    return (
      <Txt size={14} lead={21} tone="slate" className="mt-8 block">
        The comparison could not be read just now. Try again in a minute.
      </Txt>
    )
  }
  if (!body) {
    return (
      <div className="mt-8" role="status">
        <Txt size={13} lead={20} tone="steel">
          Finding similar agents across the registry and calling each one. This takes a few seconds.
        </Txt>
        <div className="mt-4 animate-pulse space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-10 bg-souk-surface2" />
          ))}
        </div>
      </div>
    )
  }

  const [subject, ...peers] = body.agents
  if (!subject) return null
  let lastGroup = ''
  const shownTask = task || DEFAULT_TASK[subject.category] || ''

  return (
    <div className="mt-8">
      <Txt size={15} lead={23} tone="slate" className="block max-w-[70ch]">
        {peers.length > 0
          ? `${subject.name} next to the ${peers.length} closest agents we found on the ERC-8004 registry, each measured the same way. There is no overall score: weigh the rows that matter to you.`
          : `We found no close peers for ${subject.name} on the registry yet.`}
      </Txt>

      <form
        className="mt-6 flex max-w-[860px] flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault()
          if (!task && shownTask) setTask(shownTask)
          void askQuotes(body.agents.map((a) => a.tokenId), shownTask.trim())
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] text-souk-steel">The same task for every agent</span>
          <textarea
            value={shownTask}
            onChange={(e) => setTask(e.target.value)}
            maxLength={400}
            rows={2}
            className="w-full resize-y rounded-[10px] border border-souk-hair bg-souk-canvas px-3 py-2 text-[13px] leading-[19px] text-souk-ink focus:border-souk-data focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={asking || !shownTask.trim()}
          className="shrink-0 rounded-[10px] border border-souk-hair px-4 py-2.5 text-[13px] font-semibold text-souk-ink transition hover:border-souk-accent disabled:opacity-50 sm:mt-[22px]"
        >
          {asking ? 'Asking' : 'Ask each for a quote'}
        </button>
      </form>
      {quoteNote ? (
        <Txt size={12} lead={18} tone="steel" className="mt-2 block">
          {quoteNote}
        </Txt>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-[14px] border border-souk-hair">
        <table className="w-full min-w-[680px] border-collapse text-left text-[13px] leading-[19px]">
          <thead>
            <tr className="border-b border-souk-hair">
              <th scope="col" className="sticky left-0 z-10 w-[130px] bg-souk-canvas p-3 align-bottom md:w-[220px]">
                <span className="sr-only">Measure</span>
              </th>
              {body.agents.map((a, i) => (
                <th key={a.tokenId} scope="col" className={`p-3 align-bottom font-normal ${i === 0 ? 'bg-souk-surface2/60' : ''}`}>
                  <Link to={`/agents/${a.chainId}/${a.tokenId}`} className="group flex items-center gap-2">
                    <img
                      src={a.image ?? defaultAvatarFor(a.chainId, a.tokenId)}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-[8px] border border-souk-hair object-cover"
                      onError={(e) => {
                        e.currentTarget.src = defaultAvatarFor(a.chainId, a.tokenId)
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-souk-ink group-hover:underline">{a.name}</span>
                      <span className="block font-mono text-[10px] text-souk-labels">
                        #{a.tokenId}
                        {i === 0 ? ', this agent' : a.house ? ', ours' : ''}
                      </span>
                    </span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const head = row.group !== lastGroup
              lastGroup = row.group
              return [
                head ? (
                  <tr key={`${row.group}-head`}>
                    <th
                      scope="colgroup"
                      colSpan={body.agents.length + 1}
                      className="border-t border-souk-hair px-3 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data"
                    >
                      {row.group}
                    </th>
                  </tr>
                ) : null,
                <tr key={row.label} className="border-t border-souk-hair/60">
                  <th scope="row" title={row.source} className="sticky left-0 z-10 bg-souk-canvas p-3 align-top font-normal">
                    <span className="block text-souk-ink">{row.label}</span>
                    <span className="mt-0.5 hidden text-[11px] leading-[16px] text-souk-labels md:block">{row.source}</span>
                  </th>
                  {body.agents.map((a, i) => (
                    <td key={a.tokenId} className={`p-3 align-top text-souk-slate ${i === 0 ? 'bg-souk-surface2/60' : ''}`}>
                      {row.cell(a, quotes?.get(a.tokenId))}
                    </td>
                  ))}
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>

      <Txt size={11} lead={17} tone="steel" className="mt-3 block max-w-[80ch]">
        Peers are chosen by category and description from a registry search. Jobs are read from the ERC-8183 contract
        through job #{body.jobsIndexedThrough.toLocaleString('en-US')}. Vault hires and paid calls are not jobs, so an
        agent that sells those shows none here. Read {new Date(body.readAt).toLocaleTimeString()}.
      </Txt>
    </div>
  )
}
