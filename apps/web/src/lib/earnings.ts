// Settled earnings, per asset. The chart and the calendar both read this module,
// so a dollar figure on one is the same arithmetic as the other: buyer hires only,
// sandbox receipts out, raw amounts kept as bigint until the very last step.
import { formatUnits } from '@agora/core'
import type { PayeeHire } from './api'
import { settlementAssetFor } from './contracts'

const DAY = 86_400_000

export interface EarningsAsset {
  key: string
  chainId: number
  symbol: string
  decimals: number
  hires: PayeeHire[]
  totalRaw: bigint
}

function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
}

export function earningsAssets(hires: PayeeHire[] | null): EarningsAsset[] {
  const byAsset = new Map<string, EarningsAsset>()
  for (const h of hires ?? []) {
    if (h.mode === 'sandbox' || !isCustomer(h) || h.decimals === null) continue
    let raw: bigint
    try {
      raw = BigInt(h.amount)
    } catch {
      // an unreadable amount is left out rather than charted as zero
      continue
    }
    if (raw <= BigInt(0)) continue
    const key = `${h.chainId}:${h.symbol}`
    const entry =
      byAsset.get(key) ??
      ({
        key,
        chainId: h.chainId,
        symbol: h.symbol,
        decimals: h.decimals,
        hires: [],
        totalRaw: BigInt(0),
      } satisfies EarningsAsset)
    entry.hires.push(h)
    entry.totalRaw += raw
    byAsset.set(key, entry)
  }
  return [...byAsset.values()].sort((a, b) => b.hires.length - a.hires.length)
}

// the chart shows one unit at a time. Prefer the chain's settlement asset, then a
// stablecoin by name, then whichever asset the seller was paid in most often.
export function primaryEarningsAsset(
  assets: EarningsAsset[],
  chainId: number | null,
): EarningsAsset | null {
  if (assets.length === 0) return null
  const settlement = chainId === null ? null : settlementAssetFor(chainId)?.symbol
  return (
    (settlement
      ? assets.find((a) => a.chainId === chainId && a.symbol === settlement)
      : undefined) ??
    assets.find((a) => ['$U', 'sUSD', 'USDT', 'USDC'].includes(a.symbol)) ??
    assets[0]
  )
}

function amountOf(h: PayeeHire): number {
  return Number(formatUnits(BigInt(h.amount), h.decimals ?? 18))
}

function settledAt(h: PayeeHire): number {
  return Date.parse(h.createdAt)
}

export function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

export interface EarningsPoint {
  t: number
  v: number
}

// the visible line starts at the total already banked when the window opens, so
// the chart reads as the balance over time rather than a line that always starts
// at zero. The final point lands on now, so every range ends at the same edge.
export function cumulativeEarnings(
  asset: EarningsAsset,
  fromMs: number,
  toMs: number,
): { points: EarningsPoint[]; baseline: number; added: number; count: number } {
  const sorted = [...asset.hires].sort((a, b) => settledAt(a) - settledAt(b))
  let baseline = 0
  let added = 0
  let count = 0
  const points: EarningsPoint[] = []

  for (const h of sorted) {
    const t = settledAt(h)
    if (!Number.isFinite(t) || t > toMs) continue
    const amount = amountOf(h)
    if (t < fromMs) {
      baseline += amount
      continue
    }
    points.push({ t, v: baseline + added + amount })
    added += amount
    count += 1
  }

  // a flat segment before the first settlement of the window, and one on to now
  const line: EarningsPoint[] = [{ t: fromMs, v: baseline }, ...points]
  const last = line[line.length - 1]
  if (last.t < toMs) line.push({ t: toMs, v: last.v })
  return { points: line, baseline, added, count }
}

export function earningsByDay(asset: EarningsAsset): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const h of asset.hires) {
    const t = settledAt(h)
    if (!Number.isFinite(t)) continue
    const day = dayKey(t)
    byDay.set(day, (byDay.get(day) ?? 0) + amountOf(h))
  }
  return byDay
}

// The monthly P&L calendar reads a day as a small ledger: what it paid, how
// many settlements landed, how many went forward or back, and how many are
// still open. A day with a zero net is still a trading day when trades > 0.
export interface EarningsDayStat {
  pnl: number
  trades: number
  wins: number
  losses: number
  open: number
}

export function earningsDayStats(asset: EarningsAsset): Map<string, EarningsDayStat> {
  const byDay = new Map<string, EarningsDayStat>()
  for (const h of asset.hires) {
    const t = settledAt(h)
    if (!Number.isFinite(t)) continue
    const key = dayKey(t)
    const stat = byDay.get(key) ?? { pnl: 0, trades: 0, wins: 0, losses: 0, open: 0 }
    const amount = amountOf(h)
    stat.pnl += amount
    stat.trades += 1
    if (amount > 0) stat.wins += 1
    else if (amount < 0) stat.losses += 1
    if (h.active) stat.open += 1
    byDay.set(key, stat)
  }
  return byDay
}

export function totalEarnings(asset: EarningsAsset): number {
  return Number(formatUnits(asset.totalRaw, asset.decimals))
}

// a figure for a headline: two decimals once it is a whole unit, four below it
export function formatEarnings(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  const digits = n !== 0 && Math.abs(n) < 1 ? 4 : 2
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

// a figure for an axis or a tooltip, where space is the constraint
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 1) return n.toFixed(2)
  if (n === 0) return '0'
  return n.toFixed(3)
}

export { DAY as EARNINGS_DAY }
