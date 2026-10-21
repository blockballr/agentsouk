import { useMemo, useState } from 'react'
import { Row, SectionHead, Txt } from './souk'
import { settlementAssetFor } from '../lib/contracts'
import type { PayeeHire } from '../lib/api'
import { PnlCalendar } from './PnlCalendar'
import { EarningsChart } from './EarningsChart'
import {
  EARNINGS_DAY,
  cumulativeEarnings,
  earningsAssets,
  primaryEarningsAsset,
  type EarningsAsset,
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
  listedAt,
}: {
  hires: PayeeHire[] | null
  chainId: number | null
  // the day the seller first listed an agent, so the line starts at the listing
  // rather than at the first settlement
  listedAt?: string | null
}) {
  const [range, setRange] = useState<RangeKey>('30D')
  const assets = useMemo(() => earningsAssets(hires), [hires])
  const asset = useMemo(() => primaryEarningsAsset(assets, chainId), [assets, chainId])

  if (hires === null) {
    return (
      <div className="flex flex-col gap-2">
        <SectionHead title="Earnings" note="SETTLED ONLY" />
        <Txt size={12} lead={18} tone="steel">
          The receipts read could not be reached just now, so the earnings line is
          not being drawn from a guess.
        </Txt>
      </div>
    )
  }

  // The chart and calendar are the board's own furniture, so they stay on the
  // page before the first settlement: a flat zero line and an empty calendar say
  // "nothing paid yet" without hiding where the money view will live.
  const shown: EarningsAsset =
    asset ?? {
      key: `empty:${chainId ?? 0}`,
      chainId: chainId ?? 0,
      symbol: (chainId === null ? null : settlementAssetFor(chainId)?.symbol) ?? '$U',
      decimals: 18,
      hires: [],
      totalRaw: BigInt(0),
    }

  const now = Date.now()
  const days = WINDOW_DAYS[range]
  const settled = shown.hires.map((h) => Date.parse(h.createdAt)).filter(Number.isFinite)
  const listed = listedAt ? Date.parse(listedAt) : Number.NaN
  const floor = Number.isFinite(listed) ? Math.min(listed, now) : null
  // the line begins on the day the first agent was listed; a fixed window never
  // starts before that, and ALL always starts there
  const from = days === null
    ? floor ?? (settled.length === 0 ? now - 30 * EARNINGS_DAY : Math.min(now, ...settled))
    : Math.max(now - days * EARNINGS_DAY, floor ?? 0)
  const series = cumulativeEarnings(shown, from, now)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex h-[440px] min-h-0 flex-col rounded-[14px] border border-souk-hair bg-souk-surface1/40 p-4 backdrop-blur-md">
          <Row justify="between" align="center" className="mb-2 shrink-0">
            <Txt size={10} lead={14} mono upper tone="muted">
              Cumulative P&amp;L
            </Txt>
            <div className="inline-flex items-center gap-0.5 rounded-[7px] border border-souk-hair bg-souk-surface2 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                  className={`h-6 rounded-[5px] px-2 text-[9px] font-bold uppercase tracking-[0.06em] transition ${
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
          <EarningsChart points={series.points} className="min-h-0 flex-1" />
          <Row justify="between" align="center" className="shrink-0 px-0.5 pt-2">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <Txt key={f} size={9} lead={14} mono tone="muted">
                {shortDay(series.points[0].t + (now - series.points[0].t) * f)}
              </Txt>
            ))}
          </Row>
        </div>

        <PnlCalendar asset={shown} now={now} className="h-[440px]" />
      </div>

      <Txt size={9} lead={14} tone="muted">
        Earnings are the provider wallet&apos;s settled receipts. When a listing has an executor
        wallet, the provider and executor wallets are both read, and a payment counted once by its
        payment id.
      </Txt>
    </div>
  )
}

function shortDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
