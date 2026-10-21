import { useMemo, useState } from 'react'
import { Row, SectionHead, Stack, Txt } from './souk'
import type { PayeeHire } from '../lib/api'
import {
  EARNINGS_DAY,
  cumulativeEarnings,
  dayKey,
  earningsAssets,
  earningsByDay,
  formatCompact,
  formatEarnings,
  primaryEarningsAsset,
  totalEarnings,
  type EarningsAsset,
  type EarningsPoint,
} from '../lib/earnings'

const RANGES = [
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: 'ALL', days: null },
] as const

type RangeKey = (typeof RANGES)[number]['key']

const WINDOW_DAYS: Record<RangeKey, number | null> = {
  '7D': 7,
  '30D': 30,
  ALL: null,
}

// The money view: one cumulative line in the asset the seller is actually paid
// in, with the calendar underneath it. Board A is where the seller starts the
// morning, so the earned figure belongs above the operational checks.
export function EarningsPanel({
  hires,
  chainId,
}: {
  hires: PayeeHire[] | null
  chainId: number | null
}) {
  const [range, setRange] = useState<RangeKey>('30D')
  const assets = useMemo(() => earningsAssets(hires), [hires])
  const asset = useMemo(() => primaryEarningsAsset(assets, chainId), [assets, chainId])

  if (hires === null) {
    return (
      <Stack surface radius={16} gap={10} className="p-5">
        <SectionHead title="Earnings" note="SETTLED ONLY" />
        <Txt size={12} lead={18} tone="steel">
          The receipts read could not be reached just now, so the earnings line is
          not being drawn from a guess.
        </Txt>
      </Stack>
    )
  }

  if (!asset) {
    return (
      <Stack surface radius={16} gap={10} className="p-5">
        <SectionHead title="Earnings" note="SETTLED ONLY" />
        <Txt size={13} lead={20} tone="ink">
          No settled buyer payment yet.
        </Txt>
        <Txt size={12} lead={18} tone="steel">
          The line starts at the first settlement. Sandbox receipts and our own
          checks never count here.
        </Txt>
      </Stack>
    )
  }

  const now = Date.now()
  const days = WINDOW_DAYS[range]
  const from = days === null
    ? Math.min(now, ...asset.hires.map((h) => Date.parse(h.createdAt)).filter(Number.isFinite))
    : now - days * EARNINGS_DAY
  const series = cumulativeEarnings(asset, from, now)
  const total = totalEarnings(asset)
  const others = assets.filter((a) => a.key !== asset.key)

  return (
    <Stack surface radius={16} gap={14} className="p-5">
      <SectionHead title="Earnings" note="SETTLED ONLY" />

      <Row justify="between" align="start" gap={16} className="flex-wrap">
        <Stack gap={3}>
          <Row align="baseline" gap={8} className="flex-wrap">
            <Txt size={30} lead={38} weight="bold" mono tone="ink">
              {formatEarnings(total)}
            </Txt>
            <Txt size={13} lead={20} weight="semibold" tone="muted">
              {asset.symbol}
            </Txt>
          </Row>
          <Txt size={11} lead={16} tone="muted">
            {series.count === 0
              ? days === null
                ? 'No settled payment yet.'
                : `No new settlement in the last ${days} days.`
              : `+${formatEarnings(series.added)} ${asset.symbol} ${
                  days === null ? 'all time' : `in the last ${days} days`
                } · ${series.count} ${series.count === 1 ? 'hire' : 'hires'}`}
          </Txt>
        </Stack>

        <div className="inline-flex shrink-0 items-center gap-0.5 rounded-[8px] border border-souk-hair bg-souk-surface2 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`h-7 rounded-[6px] px-2.5 text-[10px] font-bold uppercase tracking-[0.06em] transition ${
                range === r.key
                  ? 'bg-souk-indigo text-souk-white'
                  : 'text-souk-muted hover:text-souk-ink'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </Row>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <Stack gap={2} className="min-w-0">
          <EarningsChart points={series.points} />
          <Row justify="between" align="center" className="px-0.5 pt-1">
            <Txt size={9} lead={14} mono tone="muted">
              {shortDay(series.points[0].t)}
            </Txt>
            <Txt size={9} lead={14} mono tone="muted">
              {shortDay((series.points[0].t + now) / 2)}
            </Txt>
            <Txt size={9} lead={14} mono tone="muted">
              {shortDay(now)}
            </Txt>
          </Row>
        </Stack>

        <EarningsCalendar asset={asset} now={now} />
      </div>

      <Txt size={10} lead={16} tone="muted">
        Buyer settlements only, sandbox receipts out.{' '}
        {others.length > 0
          ? `Also settled: ${others
              .map((a) => `${formatEarnings(totalEarnings(a))} ${a.symbol}`)
              .join(' + ')}.`
          : `One line in ${asset.symbol}, the asset these listings are paid in.`}
      </Txt>
    </Stack>
  )
}

function shortDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function EarningsChart({ points }: { points: EarningsPoint[] }) {
  const W = 640
  const H = 150
  const PAD = 6
  const values = points.map((p) => p.v)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const spread = high - low
  const margin = spread === 0 ? Math.max(1, high * 0.04) : spread * 0.1
  const min = Math.max(0, low - margin)
  const max = high + margin
  const span = max - min || 1
  const from = points[0].t
  const to = points[points.length - 1].t
  const width = to - from || 1

  const x = (t: number) => ((t - from) / width) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${W} ${H} L0 ${H} Z`

  return (
    <div className="flex gap-2">
      <div className="flex w-11 shrink-0 flex-col justify-between py-0.5 text-right">
        <Txt size={9} lead={12} mono tone="muted">{formatCompact(max)}</Txt>
        <Txt size={9} lead={12} mono tone="muted">{formatCompact((min + max) / 2)}</Txt>
        <Txt size={9} lead={12} mono tone="muted">{formatCompact(min)}</Txt>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[150px] min-w-0 flex-1 text-souk-data"
        role="img"
        aria-label="Cumulative settled earnings"
      >
        <defs>
          <linearGradient id="earnings-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-souk-muted" stroke="currentColor" strokeOpacity="0.16" strokeDasharray="2 4">
          <line x1="0" y1={PAD} x2={W} y2={PAD} vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={H - PAD} x2={W} y2={H - PAD} vectorEffect="non-scaling-stroke" />
        </g>
        <path d={area} fill="url(#earnings-fill)" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

const CELL_LEVEL = [
  'bg-souk-surface2',
  'bg-souk-data/20',
  'bg-souk-data/40',
  'bg-souk-data/70',
  'bg-souk-data',
]

// Twelve aligned weeks, one square a day, the way a contribution grid reads: the
// empty weeks are as useful as the paid ones, because they show the shape of the
// run rather than only the days that landed.
function EarningsCalendar({ asset, now }: { asset: EarningsAsset; now: number }) {
  const weeks = 12
  const byDay = useMemo(() => earningsByDay(asset), [asset])
  const today = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  )
  const start = today - new Date(today).getUTCDay() * EARNINGS_DAY - (weeks - 1) * 7 * EARNINGS_DAY
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => start + (w * 7 + d) * EARNINGS_DAY),
  )
  const max = Math.max(1, ...byDay.values())
  const first = columns[0][0]

  return (
    <Stack gap={8} className="min-w-0 border-t border-souk-hair pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
      <Row justify="between" align="center" gap={8}>
        <Txt size={11} lead={16} weight="semibold" tone="ink">
          Earnings calendar
        </Txt>
        <Txt size={9} lead={14} mono upper tone="muted">
          12 weeks
        </Txt>
      </Row>

      <div className="flex gap-2">
        <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-[1px]">
          {['M', '', 'W', '', 'F', '', ''].map((label, i) => (
            <span key={i} className="flex h-[12px] items-center text-[8px] leading-none text-souk-muted">
              {label}
            </span>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-12 gap-[3px]">
          {columns.map((column, w) => (
            <div key={w} className="grid grid-rows-7 gap-[3px]">
              {column.map((t) => {
                const future = t > today
                const value = byDay.get(dayKey(t)) ?? 0
                const level = value === 0 ? 0 : Math.min(4, 1 + Math.floor((value / max) * 3.2))
                return (
                  <span
                    key={t}
                    title={
                      future
                        ? undefined
                        : `${shortDay(t)}: ${value === 0 ? 'no settlement' : `${formatEarnings(value)} ${asset.symbol}`}`
                    }
                    className={`h-[12px] w-full rounded-[2px] ${future ? 'opacity-0' : CELL_LEVEL[level]}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <Row justify="between" align="center" gap={6}>
        <Txt size={9} lead={14} mono tone="muted">
          {shortDay(first)} – {shortDay(today)}
        </Txt>
        <Row align="center" gap={1}>
          <Txt size={8} lead={12} tone="muted" className="mr-1">
            less
          </Txt>
          {CELL_LEVEL.map((cls, i) => (
            <span key={i} className={`h-[7px] w-[7px] rounded-[1px] ${cls}`} />
          ))}
          <Txt size={8} lead={12} tone="muted" className="ml-1">
            more
          </Txt>
        </Row>
      </Row>
    </Stack>
  )
}
