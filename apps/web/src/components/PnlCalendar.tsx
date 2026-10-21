import { Fragment, useMemo, useState } from 'react'
import {
  EARNINGS_DAY,
  dayKey,
  earningsDayStats,
  formatEarnings,
  type EarningsAsset,
  type EarningsDayStat,
} from '../lib/earnings'
import { Txt } from './souk'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const DAY = EARNINGS_DAY

function mondayOf(t: number): number {
  const d = new Date(t)
  const back = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY
}

function shortDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function money(value: number): string {
  return `${value > 0 ? '+' : ''}${formatEarnings(value)}`
}

function toneFor(stat: EarningsDayStat | undefined, future: boolean, inMonth: boolean): string {
  if (!inMonth) return 'border-white/[0.04] bg-white/[0.01] text-souk-muted/40'
  if (future) return 'border-white/[0.06] bg-white/[0.02] text-souk-muted/50'
  if (!stat || stat.trades === 0) return 'border-souk-hair bg-souk-surface1/40 text-souk-muted'
  if (stat.pnl > 0) return 'border-souk-data/30 bg-souk-data/12 text-souk-data'
  if (stat.pnl < 0) return 'border-souk-peach/30 bg-souk-peach/12 text-souk-peach'
  return 'border-souk-hair bg-white/[0.04] text-souk-steel'
}

// The P&L calendar: one month at a time, Monday to Friday plus a week total,
// with the month changed by the two square arrows. It is self-contained so the
// portfolio and any future seller surface can render the same calendar.
export function PnlCalendar({
  asset,
  now,
  className = '',
}: {
  asset: EarningsAsset
  now: number
  className?: string
}) {
  const stats = useMemo(() => earningsDayStats(asset), [asset])
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  const year = new Date(now).getUTCFullYear()
  const currentMonth = new Date(now).getUTCMonth()
  // 0 is the current month; each step back is one month, floored at January
  const [monthOffset, setMonthOffset] = useState(0)
  const month = currentMonth - monthOffset

  const first = Date.UTC(year, month, 1)
  const last = Date.UTC(year, month + 1, 0)
  const start = mondayOf(first)
  const startOfLastWeek = mondayOf(last)
  const weeks: number[] = []
  for (let w = start; w <= startOfLastWeek; w += 7 * DAY) weeks.push(w)

  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const canBack = monthOffset < currentMonth
  const canForward = monthOffset > 0

  return (
    <div
      className={`flex min-h-0 flex-col rounded-[14px] border border-souk-hair bg-souk-surface1/40 p-4 backdrop-blur-md ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <Txt size={10} lead={14} mono upper tone="muted">
          PnL calendar
        </Txt>
        <div className="flex items-center gap-2">
          <Txt size={10} lead={14} mono tone="ink">
            {label}
          </Txt>
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canBack}
            onClick={() => setMonthOffset((o) => Math.min(currentMonth, o + 1))}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-souk-hair bg-white/[0.03] text-souk-steel transition hover:text-souk-ink disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canForward}
            onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-souk-hair bg-white/[0.03] text-souk-steel transition hover:text-souk-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-1 font-mono text-[8px] uppercase tracking-wide text-souk-muted">
            {d}
          </div>
        ))}
        <div className="px-1 font-mono text-[8px] uppercase tracking-wide text-souk-muted">Week</div>
      </div>

      <div className="mt-1 grid min-h-0 flex-1 auto-rows-fr grid-cols-6 gap-1">
        {weeks.map((w) => {
          const days = WEEKDAYS.map((_, i) => w + i * DAY)
          const weekStats = days.reduce<EarningsDayStat>(
            (acc, d) => {
              const s = stats.get(dayKey(d))
              if (!s) return acc
              return {
                pnl: acc.pnl + s.pnl,
                trades: acc.trades + s.trades,
                wins: acc.wins + s.wins,
                losses: acc.losses + s.losses,
                open: acc.open + s.open,
              }
            },
            { pnl: 0, trades: 0, wins: 0, losses: 0, open: 0 },
          )
          return (
            <Fragment key={w}>
              {days.map((d) => {
                const inMonth = new Date(d).getUTCMonth() === month
                const future = d > today
                const stat = stats.get(dayKey(d))
                return (
                  <div
                    key={d}
                    className={`flex min-h-0 flex-col justify-between rounded-[10px] border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm ${toneFor(stat, future, inMonth)}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-mono text-[11px] font-semibold leading-none">
                        {new Date(d).getUTCDate()}
                      </span>
                      {inMonth && stat && stat.open > 0 ? (
                        <span className="font-mono text-[7px] uppercase leading-none opacity-70">
                          {stat.open} open
                        </span>
                      ) : null}
                    </div>
                    {inMonth && !future && stat && stat.trades > 0 ? (
                      <div>
                        <div className="font-mono text-[11px] font-bold leading-none">{money(stat.pnl)}</div>
                        <div className="mt-1 font-mono text-[8px] leading-[11px] opacity-70">
                          {stat.trades} {stat.trades === 1 ? 'trade' : 'trades'}
                        </div>
                        <div className="font-mono text-[8px] leading-[11px] opacity-70">
                          {stat.wins}W / {stat.losses}L
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <div
                className={`flex min-h-0 flex-col justify-between rounded-[10px] border p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm ${
                  weekStats.trades === 0
                    ? 'border-souk-hair bg-white/[0.03] text-souk-muted'
                    : weekStats.pnl > 0
                      ? 'border-souk-data/30 bg-souk-data/12 text-souk-data'
                      : weekStats.pnl < 0
                        ? 'border-souk-peach/30 bg-souk-peach/12 text-souk-peach'
                        : 'border-souk-hair bg-white/[0.04] text-souk-steel'
                }`}
              >
                <div className="font-mono text-[8px] uppercase leading-[11px] opacity-70">
                  {shortDay(w)} - {shortDay(w + 4 * DAY)}
                </div>
                {weekStats.trades === 0 ? (
                  <div className="font-mono text-[8px] opacity-70">No trades</div>
                ) : (
                  <div>
                    <div className="font-mono text-[11px] font-bold leading-none">{money(weekStats.pnl)}</div>
                    <div className="mt-1 font-mono text-[8px] leading-[11px] opacity-70">
                      {weekStats.trades} trades /{' '}
                      {days.filter((d) => (stats.get(dayKey(d))?.trades ?? 0) > 0).length} days
                    </div>
                    <div className="font-mono text-[8px] leading-[11px] opacity-70">
                      {weekStats.wins}W / {weekStats.losses}L
                      {weekStats.open > 0 ? ` / ${weekStats.open} open` : ''}
                    </div>
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>

      <Txt size={8} lead={12} tone="muted" className="mt-2">
        P&L per settled day, provider wallet (plus the executor wallet when one is assigned). Green
        is a paid day, peach a day that went backwards, blank no trades. Recording starts this week.
      </Txt>
    </div>
  )
}
