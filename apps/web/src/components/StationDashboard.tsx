import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { explorerTxBase } from '../lib/contracts'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface Preview {
  generatedAt: string
  overview: {
    chainId: number
    windows: { key: 'today' | 'week' | 'all'; buyerHires: number; ownChecks: number; settled: { chainId: number; symbol: string; amount: string }[] }[]
    categories: { key: string; listed: number; answering: number }[]
    agentsListed: number
    agentsAnswering: number
    offMarket: number
    passports: number | null
    agentId?: { holders: number; hires: number; since: string } | null
    failedChecksToday: number
    hiresByDay: { day: string; count: number }[]
    checksByDay: { day: string; passed: number; failed: number }[]
    stuck: number
  }
  shelf: {
    windowDays: number
    onShelf: { total: number; answering: number }
    neverEligible: number
    failing: { tokenId: string; name: string; category: string; ours: boolean; status: string; daysLeft: number }[]
    delisted: { tokenId: string; name: string; daysOff: number }[]
  }
  operations: {
    settlement: string
    jobs: { name: string; finishedAt: string | null; ok: boolean | null }[]
    relay: { address: string | null; balance: string | null }
    stores: { name: string; mode: string; durable: boolean }[]
  }
  hires: { createdAt: string; agentName: string; chainId?: number; tokenId: string; amount: string; symbol: string; txHash: string | null; buyer: string | null }[]
}

const CATEGORY_LABEL: Record<string, string> = {
  rebalancing: 'Rebalancing',
  'grid-trading': 'Grid trading',
  yield: 'Yield',
  'health-factor': 'Health factor',
  general: 'General',
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 129600) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

function Panel({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-[16px] border border-souk-hair bg-souk-surface1/60 p-4 md:p-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold text-souk-ink">{title}</h2>
        {note ? <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">{note}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-souk-hair bg-souk-surface1/60 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">{label}</div>
      <div className="mt-1.5 font-mono text-[26px] font-bold leading-[32px] text-souk-ink">{value}</div>
      {sub ? <div className="mt-1 truncate text-[12px] text-souk-steel">{sub}</div> : null}
    </div>
  )
}

// one series per chart, so the title names it and no legend box is needed; a
// stacked pair carries a legend. each bar holds its own figure for hover and
// screen readers, and a hidden table repeats the data
function Bars({
  days,
  series,
  label,
}: {
  days: string[]
  series: { name: string; values: number[]; className: string }[]
  label: string
}) {
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
  const max = Math.max(1, ...totals)
  if (totals.every((t) => t === 0)) {
    return <p className="flex h-[120px] items-center text-[13px] text-souk-steel">Nothing in these {days.length} days.</p>
  }
  return (
    <div>
      {series.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-souk-steel">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-[2px] ${s.className}`} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex h-[120px] items-end gap-[2px]" role="img" aria-label={label}>
        {days.map((day, i) => (
          <div
            key={day}
            className="flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px]"
            title={`${day}: ${series.map((s) => `${s.values[i] ?? 0} ${s.name.toLowerCase()}`).join(', ')}`}
          >
            {series.map((s, si) => {
              const v = s.values[i] ?? 0
              if (v === 0) return null
              const top = si === series.length - 1 || series.slice(si + 1).every((t) => (t.values[i] ?? 0) === 0)
              return (
                <div
                  key={s.name}
                  className={`${s.className} ${top ? 'rounded-t-[4px]' : ''}`}
                  style={{ height: `${(v / max) * 100}%`, minHeight: 2 }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-souk-labels">
        <span>{days[0]?.slice(5)}</span>
        <span>{days[days.length - 1]?.slice(5)}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {days.map((day, i) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {series.map((s) => (
                <td key={s.name}>{`${s.values[i] ?? 0} ${s.name}`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StationDashboard({ preview }: { preview: boolean }) {
  const [data, setData] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const read = () =>
      fetch(`${API_BASE}/station/preview`)
        .then((r) => r.json())
        .then((b) => {
          if (!alive) return
          if (b?.success) {
            setData(b as Preview)
            setFailed(false)
          } else setFailed(true)
        })
        .catch(() => alive && setFailed(true))
    void read()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read()
    }, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  if (failed && !data) {
    return <p className="mt-6 text-[14px] text-souk-slate">The station cannot be read just now. It refreshes every minute.</p>
  }
  if (!data) {
    return (
      <div className="mt-6 grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading the station">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-24 rounded-[14px] bg-souk-surface2" />
        ))}
      </div>
    )
  }

  const o = data.overview
  const win = (k: 'today' | 'week' | 'all') => o.windows.find((w) => w.key === k)
  // mainnet money leads; testnet totals are named as testnet, never added in
  const settledAll = [...(win('all')?.settled ?? [])].sort((a, b) => (a.chainId === 56 ? -1 : 0) - (b.chainId === 56 ? -1 : 0))
  const settled = settledAll[0]
  const settledSub = settledAll.length
    ? settledAll.map((t, i) => `${i ? `${Number(t.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} ` : ''}${t.symbol} on ${t.chainId === 56 ? 'mainnet' : 'testnet'}`).join(', ') + ', all time'
    : 'nothing settled yet'
  const failingJobs = data.operations.jobs.filter((j) => j.ok === false).length

  return (
    <div className="mt-6 space-y-4">
      {preview ? (
        <p className="rounded-[12px] border border-souk-hair bg-souk-surface2/50 px-4 py-3 text-[13px] leading-[20px] text-souk-slate">
          You are seeing the read-only preview, refreshed every minute from production. It leaves out member wallets and
          every control; members sign in for those.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Agents answering" value={`${o.agentsAnswering}`} sub={`of ${o.agentsListed} listed, ${o.offMarket} off the market`} />
        <Stat label="Buyer hires" value={`${win('all')?.buyerHires ?? 0}`} sub={`${win('today')?.buyerHires ?? 0} today, ${win('week')?.buyerHires ?? 0} this week`} />
        <Stat
          label="Settled by buyers"
          value={settled ? `${Number(settled.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '0'}
          sub={settledSub}
        />
        <Stat
          label="Agent ID holders"
          value={o.agentId ? `${o.agentId.holders}` : '0'}
          sub={o.agentId ? `${o.agentId.hires} vault hires since 18 Nov` : 'not counted yet'}
        />
        <Stat
          label="Needs attention"
          value={`${o.stuck + o.failedChecksToday + failingJobs}`}
          sub={`${o.stuck} stuck, ${o.failedChecksToday} failed checks today, ${failingJobs} failing jobs`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Buyer hires per day" note={`${o.hiresByDay.length} days`}>
          <Bars
            label="Buyer hires per day"
            days={o.hiresByDay.map((d) => d.day)}
            series={[{ name: 'Hires', values: o.hiresByDay.map((d) => d.count), className: 'bg-souk-data' }]}
          />
        </Panel>
        <Panel title="Endpoint checks per day" note="passed and failed">
          <Bars
            label="Endpoint checks per day"
            days={o.checksByDay.map((d) => d.day)}
            series={[
              { name: 'Passed', values: o.checksByDay.map((d) => d.passed), className: 'bg-souk-good' },
              { name: 'Failed', values: o.checksByDay.map((d) => d.failed), className: 'bg-souk-peach' },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="The shelf" note={`${data.shelf.windowDays} day delist clock`}>
          <ul className="space-y-2">
            {o.categories.map((c) => (
              <li key={c.key} className="text-[13px]">
                <div className="flex justify-between gap-3 text-souk-slate">
                  <span>{CATEGORY_LABEL[c.key] ?? c.key}</span>
                  <span className="font-mono text-souk-ink">
                    {c.answering}/{c.listed}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-souk-surface2">
                  <div className="h-full rounded-full bg-souk-data" style={{ width: `${c.listed ? (c.answering / c.listed) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-[18px] text-souk-steel">
            Answering out of listed, per category. {data.shelf.neverEligible} registry entries never qualify, because they
            publish no endpoint a buyer can reach.
          </p>
        </Panel>

        <Panel title="On the delist clock" note={`${data.shelf.failing.length} failing`}>
          {data.shelf.failing.length === 0 ? (
            <p className="text-[13px] text-souk-slate">Every listed agent answered its last check.</p>
          ) : (
            <ul className="divide-y divide-souk-hair">
              {data.shelf.failing.slice(0, 8).map((r) => (
                <li key={r.tokenId} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <Link to={`/agents/${o.chainId}/${r.tokenId}`} className="min-w-0 truncate text-souk-ink hover:underline">
                    {r.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] text-souk-warn">
                    {r.status}, {r.daysLeft} d left
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.shelf.delisted.length > 0 ? (
            <p className="mt-3 text-[12px] text-souk-steel">{data.shelf.delisted.length} off the market, relistable once they answer.</p>
          ) : null}
        </Panel>

        <Panel title="Scheduled jobs" note={`settles in ${data.operations.settlement}`}>
          <ul className="divide-y divide-souk-hair">
            {data.operations.jobs.map((j) => (
              <li key={j.name} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <span className="min-w-0 truncate text-souk-slate">{j.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-souk-steel">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 rounded-full ${j.ok === false ? 'bg-souk-peach' : j.ok ? 'bg-souk-good' : 'bg-souk-labels'}`}
                  />
                  {j.ok === false ? 'failed' : j.ok ? 'ok' : 'no run'}, {ago(j.finishedAt)}
                </span>
              </li>
            ))}
          </ul>
          {data.operations.relay.balance ? (
            <p className="mt-3 text-[12px] text-souk-steel">
              Relay gas: {Number(data.operations.relay.balance).toFixed(4)} BNB. Stores:{' '}
              {data.operations.stores.every((s) => s.durable) ? 'all durable' : data.operations.stores.filter((s) => !s.durable).map((s) => s.name).join(', ') + ' in memory'}.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel title="Recent buyer hires" note="settled, newest first">
        {data.hires.length === 0 ? (
          <p className="text-[13px] text-souk-slate">No buyer hires yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">
                  <th className="py-2 pr-3 font-normal">When</th>
                  <th className="py-2 pr-3 font-normal">Agent</th>
                  <th className="py-2 pr-3 font-normal">Buyer</th>
                  <th className="py-2 pr-3 text-right font-normal">Paid</th>
                  <th className="py-2 font-normal">
                    <span className="sr-only">Transaction</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-souk-hair">
                {data.hires.map((h, i) => (
                  <tr key={`${h.txHash ?? h.createdAt}-${i}`}>
                    <td className="py-2 pr-3 font-mono text-[11px] text-souk-labels">{ago(h.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <Link to={`/agents/${h.chainId ?? o.chainId}/${h.tokenId}`} className="text-souk-ink hover:underline">
                        {h.agentName}
                      </Link>
                      {(h.chainId ?? o.chainId) !== 56 ? <span className="ml-1.5 font-mono text-[10px] uppercase text-souk-labels">testnet</span> : null}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-souk-steel">{h.buyer}</td>
                    <td className="py-2 pr-3 text-right font-mono text-souk-ink">
                      {Number(h.amount).toLocaleString('en-US', { maximumFractionDigits: 4 })} {h.symbol}
                    </td>
                    <td className="py-2 text-right">
                      {h.txHash ? (
                        <a href={`${explorerTxBase(h.chainId ?? o.chainId)}/tx/${h.txHash}`} target="_blank" rel="noreferrer" className="text-[11px] text-souk-sky hover:underline">
                          Transaction
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
