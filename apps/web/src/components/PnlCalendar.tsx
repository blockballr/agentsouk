import { Fragment, useMemo, useState } from 'react'
import {
  EARNINGS_DAY,
  dayKey,
  earningsDayStats,
  formatCompact,
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
  // the calendar cell is a third of the board, so a compact figure keeps the
  // amount readable at 40px without dropping the sign
  return `${value > 0 ? '+' : ''}${formatCompact(value)}`
}

function netTone(stat: EarningsDayStat): string {
  if (stat.trades === 0) return 'text-souk-muted'
  if (stat.pnl > 0) return 'text-souk-data'
  if (stat.pnl < 0) return 'text-souk-peach'
  return 'text-souk-steel'
}

function toneFor(stat: EarningsDayStat | undefined, future: boolean, inMonth: boolean): string {
  if (!inMonth) return 'border-transparent bg-transparent text-souk-muted/25'
  if (future) return 'border-souk-hair/40 bg-souk-surface2/20 text-souk-muted/40'
  if (!stat || stat.trades === 0) return 'border-souk-hair/60 bg-souk-surface2/30 text-souk-muted'
  if (stat.pnl > 0) return 'border-souk-data/25 bg-souk-data/10 text-souk-data'
  if (stat.pnl < 0) return 'border-souk-peach/25 bg-souk-peach/10 text-souk-peach'
  return 'border-souk-hair bg-souk-surface2/50 text-souk-steel'
}

function weekTone(stat: EarningsDayStat): string {
  if (stat.trades === 0) return 'border-souk-hair/60 bg-souk-surface2/25 text-souk-muted'
  if (stat.pnl > 0) return 'border-souk-data/25 bg-souk-surface2/60 text-souk-data'
  if (stat.pnl < 0) return 'border-souk-peach/25 bg-souk-surface2/60 text-souk-peach'
  return 'border-souk-hair bg-souk-surface2/60 text-souk-steel'
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1 w-1 rounded-full ${dot}`} />
      <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-souk-muted">{label}</span>
    </span>
  )
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

  const monthStats = weeks.reduce<EarningsDayStat>(
    (acc, w) => {
      for (let i = 0; i < WEEKDAYS.length; i += 1) {
        const d = w + i * DAY
        if (new Date(d).getUTCMonth() !== month) continue
        const s = stats.get(dayKey(d))
        if (!s) continue
        acc.pnl += s.pnl
        acc.trades += s.trades
        acc.wins += s.wins
        acc.losses += s.losses
        acc.open += s.open
      }
      return acc
    },
    { pnl: 0, trades: 0, wins: 0, losses: 0, open: 0 },
  )
  const decided = monthStats.wins + monthStats.losses
  const winRate = decided > 0 ? `${Math.round((monthStats.wins / decided) * 100)}%` : '-'
  const monthTone = netTone(monthStats)

  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const canBack = monthOffset < currentMonth
  const canForward = monthOffset > 0

  return (
    <div
      className={`@container flex min-h-0 flex-col rounded-none border border-souk-hair bg-souk-surface1/40 p-4 backdrop-blur-md ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Txt size={10} lead={14} mono upper tone="muted">
            P&amp;L calendar
          </Txt>
          <div className="mt-1 flex items-baseline gap-2">
            <Txt size={14} lead={18} mono tone="ink">
              {label}
            </Txt>
            <span className={`font-mono text-[12px] font-semibold tabular-nums ${monthTone}`}>
              {monthStats.trades > 0 ? money(monthStats.pnl) : '-'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canBack}
            onClick={() => setMonthOffset((o) => Math.min(currentMonth, o + 1))}
            className="flex h-7 w-7 items-center justify-center rounded-none border border-souk-hair bg-souk-surface2/50 text-souk-steel transition-colors duration-150 hover:bg-souk-surface2 hover:text-souk-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-souk-data/60 disabled:pointer-events-none disabled:opacity-30"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M10 3.5 5.5 8 10 12.5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canForward}
            onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
            className="flex h-7 w-7 items-center justify-center rounded-none border border-souk-hair bg-souk-surface2/50 text-souk-steel transition-colors duration-150 hover:bg-souk-surface2 hover:text-souk-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-souk-data/60 disabled:pointer-events-none disabled:opacity-30"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-y border-souk-hair/50 py-2">
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">Settled</div>
          <div className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-souk-ink">
            {monthStats.trades}
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">Win rate</div>
          <div className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-souk-ink">{winRate}</div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">Open</div>
          <div className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-souk-ink">
            {monthStats.open}
          </div>
        </div>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-w-0 flex-col">
          <div className="grid grid-cols-6 gap-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted"
              >
                {d}
              </div>
            ))}
            <div className="px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">
              Week
            </div>
          </div>

          <div className="mt-1 grid min-h-0 flex-1 auto-rows-fr grid-cols-6 gap-1">
            {weeks.map((w, wi) => {
              const days = WEEKDAYS.map((_, i) => w + i * DAY)
              const inMonth = days.map((d) => new Date(d).getUTCMonth() === month)
              const weekStats = days.reduce<EarningsDayStat>(
                (acc, d, i) => {
                  if (!inMonth[i]) return acc
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
                  {days.map((d, i) => {
                    const future = d > today
                    const stat = stats.get(dayKey(d))
                    return (
                      <div
                        key={d}
                        className={`flex min-h-0 flex-col justify-between rounded-none border px-1 py-1.5 ${toneFor(stat, future, inMonth[i])}`}
                        title={
                          inMonth[i] && stat
                            ? `${shortDay(d)} · ${money(stat.pnl)} · ${stat.trades} ${
                                stat.trades === 1 ? 'settlement' : 'settlements'
                              }`
                            : undefined
                        }
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] font-semibold leading-none tabular-nums">
                            {new Date(d).getUTCDate()}
                          </span>
                          {inMonth[i] && stat && stat.open > 0 ? (
                            <span
                              className="h-1 w-1 rounded-full bg-souk-sky"
                              title={`${stat.open} open`}
                            />
                          ) : null}
                        </div>
                        {inMonth[i] && !future && stat && stat.trades > 0 ? (
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[8px] font-semibold leading-[11px] tabular-nums @[360px]:text-[10px] @[360px]:leading-[13px]">
                              {money(stat.pnl)}
                            </div>
                            <div className="hidden truncate font-mono text-[8px] leading-[10px] opacity-70 @[360px]:block">
                              {stat.trades}t / {stat.wins}W/{stat.losses}L
                            </div>
                          </div>
                        ) : inMonth[i] && !future ? (
                          <span className="font-mono text-[9px] leading-none text-souk-muted/50">-</span>
                        ) : null}
                      </div>
                    )
                  })}
                  <div
                    className={`flex min-h-0 flex-col justify-between rounded-none border px-1 py-1.5 ${weekTone(weekStats)}`}
                    title={`${shortDay(w)} - ${shortDay(w + (WEEKDAYS.length - 1) * DAY)}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] opacity-70">
                        W{wi + 1}
                      </span>
                      {weekStats.open > 0 ? (
                        <span
                          className="h-1 w-1 rounded-full bg-souk-sky"
                          title={`${weekStats.open} open`}
                        />
                      ) : null}
                    </div>
                    {weekStats.trades > 0 ? (
                      <div className="min-w-0">
                        <div className="truncate font-mono text-[8px] font-semibold leading-[11px] tabular-nums @[360px]:text-[10px] @[360px]:leading-[13px]">
                          {money(weekStats.pnl)}
                        </div>
                        <div className="hidden truncate font-mono text-[8px] leading-[10px] opacity-70 @[360px]:block">
                          {weekStats.trades}t / {weekStats.wins}W/{weekStats.losses}L
                        </div>
                      </div>
                    ) : (
                      <span className="font-mono text-[9px] leading-none opacity-50">-</span>
                    )}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Legend dot="bg-souk-data" label="Up" />
          <Legend dot="bg-souk-peach" label="Down" />
          <Legend dot="bg-souk-sky" label="Open" />
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">
          Settled / UTC
        </span>
      </div>
    </div>
  )
}
