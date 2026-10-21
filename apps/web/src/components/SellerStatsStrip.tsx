import { formatUnits, timeAgo } from '@agora/core'
import { type OwnedAgentsResult, type PayeeHire } from '../lib/api'
import { settlementAssetFor } from '../lib/contracts'
import { type Catalogue, useSellerData } from '../lib/seller-data'
import { Txt } from './souk'

const DAY = 86_400_000

function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
}

function earnedLabel(list: PayeeHire[]): string {
  const totals = new Map<string, { symbol: string; raw: bigint; decimals: number | null; count: number }>()
  for (const h of list) {
    if (h.mode === 'sandbox') continue
    let raw: bigint
    try {
      raw = BigInt(h.amount)
    } catch {
      continue
    }
    const key = `${h.chainId}:${h.symbol}`
    const entry = totals.get(key) ?? { symbol: h.symbol, raw: BigInt(0), decimals: h.decimals, count: 0 }
    entry.raw += raw
    entry.count += 1
    totals.set(key, entry)
  }
  if (totals.size === 0) return 'nothing yet'
  return [...totals.values()]
    .map((e) =>
      e.decimals === null
        ? `${e.count} ${e.symbol} payments`
        : `${formatUnits(e.raw, e.decimals)} ${e.symbol}`,
    )
    .join(' + ')
}

function countWindow(list: PayeeHire[], fromMs: number, toMs: number): number {
  let n = 0
  for (const h of list) {
    const t = Date.parse(h.createdAt)
    if (Number.isFinite(t) && t >= fromMs && t < toMs) n += 1
  }
  return n
}

function latestCheckedAt(owned: OwnedAgentsResult | null): string | null {
  let latest: number | null = null
  for (const a of owned?.agents ?? []) {
    if (a.delisted || !a.verification) continue
    const t = Date.parse(a.verification.checkedAt)
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t
  }
  return latest === null ? null : new Date(latest).toISOString()
}

function catalogueFreshness(cat: Catalogue | null): string | null {
  const stamps: number[] = []
  const push = (iso: string | number | null | undefined) => {
    if (iso === null || iso === undefined) return
    const t = typeof iso === 'number' ? iso : Date.parse(iso)
    if (Number.isFinite(t)) stamps.push(t)
  }
  push(cat?.indexStatus.catalogueRefreshedAt)
  push(cat?.snapshotTime)
  push(cat?.lastTopUpAt)
  return stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString()
}

// The operational strip belongs with the people and hires surface: buyer hires,
// impressions, when the listings were last checked, and how fresh the catalogue
// is. The money view on the portfolio is the chart and the calendar, so the
// strip keeps only the settled figure and its own provenance line.
export function SellerStatsStrip() {
  const { account, owned, hires, catalogue, views, ready } = useSellerData()
  if (!account || !ready) return null

  const customers = (hires ?? []).filter(isCustomer)
  const now = Date.now()
  const recent = countWindow(customers, now - 14 * DAY, now + DAY)
  const checkedAt = latestCheckedAt(owned)
  const catFresh = catalogueFreshness(catalogue)
  const chainId = catalogue?.chainId ?? owned?.chainId ?? null
  const symbol = (chainId === null ? null : settlementAssetFor(chainId)?.symbol) ?? '$U'

  const kpis: { value: string; label: string; live: boolean }[] = [
    {
      value: hires ? earnedLabel(customers) : 'Unavailable',
      label: 'Earned, settled only',
      live: customers.length > 0,
    },
    { value: `${recent}`, label: 'Buyer hires / 14d', live: recent > 0 },
    { value: views === null ? 'Unavailable' : `${views}`, label: 'Impressions / 14d', live: Boolean(views) },
    { value: checkedAt ? timeAgo(checkedAt) : 'Unavailable', label: 'Listings checked', live: true },
    { value: catFresh ? timeAgo(catFresh) : 'Unavailable', label: 'Catalogue', live: true },
  ]

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-[10px] border border-souk-hair">
        <div className="grid grid-cols-2 gap-px bg-souk-hair sm:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col gap-1 bg-souk-canvas px-4 py-3">
              <Txt size={10} lead={14} mono upper tone="muted" className="block">
                {k.label}
              </Txt>
              <Txt
                size={16}
                lead={22}
                mono
                weight="bold"
                tone={k.live ? 'ink' : 'muted'}
                className="block"
              >
                {k.value}
              </Txt>
            </div>
          ))}
        </div>
      </div>
      <Txt size={10} lead={16} tone="muted" className="mt-2 block">
        Buyer settlements only, sandbox receipts out. One line in {symbol}, the asset these listings are paid in.
      </Txt>
    </div>
  )
}
