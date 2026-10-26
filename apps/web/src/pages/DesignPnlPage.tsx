// Local preview only: the seller's money view with a fixed set of receipts, so
// the chart and the calendar can be judged without a wallet or a live API. This
// page is not part of the shipped surface.
import { useMemo } from 'react'
import { EarningsPanel } from '../components/EarningsPanel'
import { Txt } from '../components/souk'
import type { PayeeHire } from '../lib/api'

const DAY = 86_400_000
const NOW = Date.now()
const AGENT = '0xe0b0C4e84efc42e8D91410A14a125a8759c782Fd'
const BUYER = '0x84fedaBd1b83443aD86796C15619494878B64180'

const RECEIPTS: { days: number; amount: number; active?: boolean }[] = [
  { days: 41, amount: 0.22 },
  { days: 28, amount: 0.18 },
  { days: 23, amount: 0.34 },
  { days: 18, amount: 0.12 },
  { days: 16, amount: 0.27 },
  { days: 14, amount: 0.41 },
  { days: 13, amount: 0.16 },
  { days: 11, amount: 0.33 },
  { days: 9, amount: 0.21, active: true },
  { days: 8, amount: 0.29 },
  { days: 7, amount: 0.37 },
  { days: 6, amount: 0.44 },
  { days: 5, amount: 0.19 },
  { days: 4, amount: 0.26 },
  { days: 3, amount: 0.31, active: true },
  { days: 2, amount: 0.23 },
  { days: 1, amount: 0.38 },
]

function raw(amount: number): string {
  return (BigInt(Math.round(amount * 1_000_000)) * 10n ** 12n).toString()
}

function previewHires(): PayeeHire[] {
  return RECEIPTS.map((r, i) => ({
    paymentId: `preview-${i + 1}`,
    chainId: 56,
    tokenId: '1',
    agentName: 'Grid Warden',
    client: BUYER,
    payTo: AGENT,
    txHash: null,
    mode: 'prod',
    amount: raw(r.amount),
    symbol: '$U',
    decimals: 18,
    payer: 'buyer',
    active: r.active ?? false,
    createdAt: new Date(NOW - r.days * DAY + 12 * 3_600_000).toISOString(),
  }))
}

export function DesignPnlPage() {
  const hires = useMemo(previewHires, [])
  const listedAt = new Date(NOW - 45 * DAY).toISOString()

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Txt size={10} lead={14} mono upper tone="data">
            Local preview
          </Txt>
          <h1 className="m-0 mt-1">
            <Txt size={30} lead={38} display weight="bold" tone="ink">
              Settled P&amp;L.
            </Txt>
          </h1>
        </div>
        <Txt size={11} lead={16} mono upper tone="muted">
          Mock receipts / 30 days / $U
        </Txt>
      </div>

      <div className="mt-6">
        <EarningsPanel hires={hires} chainId={56} listedAt={listedAt} />
      </div>
    </main>
  )
}
