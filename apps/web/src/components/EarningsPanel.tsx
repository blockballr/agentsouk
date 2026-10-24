import { useEffect, useMemo, useRef, useState } from 'react'
import { Row, SectionHead, Txt } from './souk'
import { settlementAssetFor } from '../lib/contracts'
import type { PayeeHire } from '../lib/api'
import { PnlCalendar } from './PnlCalendar'
import { EarningsChart } from './EarningsChart'
import {
  EARNINGS_DAY,
  cumulativeEarnings,
  earningsAssets,
  formatEarnings,
  primaryEarningsAsset,
  type EarningsAsset,
} from '../lib/earnings'

const RANGES = [
  { key: '24H', ms: EARNINGS_DAY },
  { key: '7D', ms: 7 * EARNINGS_DAY },
  { key: '30D', ms: 30 * EARNINGS_DAY },
  { key: 'ALL', ms: null },
] as const

type RangeKey = (typeof RANGES)[number]['key']

export interface EarningsAgent {
  chainId: number
  tokenId: string
  name: string
  createdAt?: string | null
}

function agentKey(chainId: number | string, tokenId: number | string): string {
  return `${chainId}:${tokenId}`
}

// The money view: one cumulative line in the asset the seller is actually paid
// in, with the calendar underneath it. Board A is where the seller starts the
// morning, so the earned figure belongs above the operational checks.
export function EarningsPanel({
  hires,
  chainId,
  listedAt,
  agents = [],
}: {
  hires: PayeeHire[] | null
  chainId: number | null
  // the day the seller first listed an agent, so the line starts at the listing
  // rather than at the first settlement
  listedAt?: string | null
  // every listing the seller owns, including ones without a settlement yet
  agents?: EarningsAgent[]
}) {
  const [range, setRange] = useState<RangeKey>('30D')
  const [applied, setApplied] = useState<string[]>([])
  const [draft, setDraft] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const options = useMemo(() => {
    const byKey = new Map<string, EarningsAgent>()
    for (const a of agents) {
      byKey.set(agentKey(a.chainId, a.tokenId), a)
    }
    for (const h of hires ?? []) {
      const key = agentKey(h.chainId, h.tokenId)
      if (!byKey.has(key)) {
        byKey.set(key, {
          chainId: h.chainId,
          tokenId: h.tokenId,
          name: h.agentName || 'Untitled agent',
        })
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [agents, hires])

  const filteredHires = useMemo(() => {
    if (!hires) return null
    if (applied.length === 0) return hires
    const chosen = new Set(applied)
    return hires.filter((h) => chosen.has(agentKey(h.chainId, h.tokenId)))
  }, [applied, hires])

  const assets = useMemo(() => earningsAssets(filteredHires), [filteredHires])
  const asset = useMemo(() => primaryEarningsAsset(assets, chainId), [assets, chainId])

  const selectedNames = applied
    .map((key) => options.find((o) => agentKey(o.chainId, o.tokenId) === key)?.name)
    .filter((name): name is string => Boolean(name))
  const pickerLabel =
    applied.length === 0
      ? 'ALL AGENTS'
      : applied.length === 1
        ? selectedNames[0] ?? '1 AGENT'
        : `${applied.length} AGENTS`

  // A click outside commits the draft, so the popup has no separate apply
  // button. Escape does the same thing for keyboard users.
  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      setApplied(draft)
      setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setApplied(draft)
      setPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [draft, pickerOpen])

  const selectedListedAt = useMemo(() => {
    if (applied.length === 0) return listedAt ?? null
    const chosen = new Set(applied)
    const dates = options
      .filter((o) => chosen.has(agentKey(o.chainId, o.tokenId)))
      .map((o) => (o.createdAt ? Date.parse(o.createdAt) : Number.NaN))
      .filter(Number.isFinite)
    if (dates.length === 0) return listedAt ?? null
    return new Date(Math.min(...dates)).toISOString()
  }, [applied, listedAt, options])

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
  const windowMs = RANGES.find((r) => r.key === range)?.ms ?? null
  const settled = shown.hires.map((h) => Date.parse(h.createdAt)).filter(Number.isFinite)
  const listed = selectedListedAt ? Date.parse(selectedListedAt) : Number.NaN
  const floor = Number.isFinite(listed) ? Math.min(listed, now) : null
  // the line begins on the day the first agent was listed; a fixed window never
  // starts before that, and ALL always starts there
  const from =
    windowMs === null
      ? floor ?? (settled.length === 0 ? now - 30 * EARNINGS_DAY : Math.min(now, ...settled))
      : Math.max(now - windowMs, floor ?? 0)
  const series = cumulativeEarnings(shown, from, now)
  const last = series.points.length > 0 ? series.points[series.points.length - 1].v : 0
  const axisFrom = series.points[0]?.t ?? from

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex h-[440px] min-h-0 flex-col rounded-none border border-souk-hair bg-souk-surface1/40 p-4 backdrop-blur-md">
          <div className="mb-2 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <Txt size={10} lead={14} mono upper tone="muted">
                Cumulative P&amp;L
              </Txt>
              <span
                className={`font-mono text-[13px] font-semibold tabular-nums ${
                  last < 0 ? 'text-souk-peach' : 'text-souk-data'
                }`}
              >
                {formatEarnings(last)}
              </span>
              <Txt size={9} lead={14} mono tone="muted">
                {shown.symbol}
              </Txt>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div ref={pickerRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  onClick={() => {
                    if (pickerOpen) {
                      setApplied(draft)
                      setPickerOpen(false)
                    } else {
                      setDraft(applied)
                      setPickerOpen(true)
                    }
                  }}
                  className="inline-flex h-7 max-w-[190px] items-center gap-1.5 rounded-full border border-souk-hair bg-souk-surface1/70 px-3 text-left backdrop-blur-md transition hover:border-souk-data/50 hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                >
                  <span className="truncate font-mono text-[9px] font-bold tracking-[0.08em] text-souk-slate">
                    {pickerLabel}
                  </span>
                  {applied.length > 1 ? (
                    <span
                      title={selectedNames.join(', ')}
                      aria-label={`Selected agents: ${selectedNames.join(', ')}`}
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-souk-hair font-mono text-[8px] leading-none text-souk-muted"
                    >
                      i
                    </span>
                  ) : null}
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-2.5 w-2.5 shrink-0 text-souk-muted transition-transform ${
                      pickerOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  >
                    <path d="m2.5 4.5 3.5 3 3.5-3" />
                  </svg>
                </button>

                {pickerOpen ? (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[250px] rounded-none border border-white/15 bg-souk-surface1/75 p-2 shadow-2xl backdrop-blur-2xl">
                    <div className="px-2 pb-1.5 pt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-souk-muted">
                      Agents
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft([])}
                      className="flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left transition hover:bg-white/5"
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-none border font-mono text-[9px] leading-none ${
                          draft.length === 0
                            ? 'border-souk-data bg-souk-data text-souk-canvas'
                            : 'border-souk-hair text-transparent'
                        }`}
                      >
                        {draft.length === 0 ? <CheckMark /> : null}
                      </span>
                      <span className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-souk-slate">
                        All agents
                      </span>
                    </button>
                    <div className="my-1 border-t border-souk-hair/60" />
                    <div className="max-h-60 overflow-y-auto">
                      {options.length === 0 ? (
                        <div className="px-2 py-2 font-mono text-[10px] text-souk-muted">
                          No listed agents yet
                        </div>
                      ) : (
                        options.map((option) => {
                          const key = agentKey(option.chainId, option.tokenId)
                          const checked = draft.includes(key)
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() =>
                                setDraft((current) =>
                                  checked
                                    ? current.filter((item) => item !== key)
                                    : [...current, key],
                                )
                              }
                              className="flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left transition hover:bg-white/5"
                            >
                              <span
                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-none border font-mono text-[9px] leading-none ${
                                  checked
                                    ? 'border-souk-data bg-souk-data text-souk-canvas'
                                    : 'border-souk-hair text-transparent'
                                }`}
                              >
                                {checked ? <CheckMark /> : null}
                              </span>
                              <span className="truncate text-[11px] leading-[15px] text-souk-slate">
                                {option.name}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="inline-flex items-center gap-0.5 rounded-none border border-souk-hair bg-souk-surface2 p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={range === r.key}
                    onClick={() => setRange(r.key)}
                    className={`h-6 rounded-none px-2 text-[9px] font-bold uppercase tracking-[0.06em] transition ${
                      range === r.key
                        ? 'bg-souk-data text-souk-canvas'
                        : 'text-souk-muted hover:text-souk-ink'
                    }`}
                  >
                    {r.key}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <EarningsChart points={series.points} className="min-h-0 flex-1" />
          {/* align the date labels with the plot, past the 56px axis and 12px gap */}
          <Row justify="between" align="center" className="shrink-0 pl-[68px] pt-2">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <Txt key={f} size={9} lead={14} mono tone="muted">
                {axisLabel(axisFrom + (now - axisFrom) * f, range)}
              </Txt>
            ))}
          </Row>
        </div>

        <PnlCalendar asset={shown} now={now} className="h-[440px]" />
      </div>

      <Txt size={9} lead={14} tone="muted">
        Earnings are the provider wallet&apos;s settled receipts. When a listing has an executor
        wallet, the provider and executor wallets are both read, and a payment counted once by its
        payment id. Record starts after first settlement.
      </Txt>
    </div>
  )
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-2.5 w-2.5"
      aria-hidden="true"
    >
      <path d="m2.5 6.5 2.2 2.2 4.8-5" />
    </svg>
  )
}

function axisLabel(t: number, range: RangeKey): string {
  if (range === '24H') {
    return new Date(t).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
  }
  return shortDay(t)
}

function shortDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
