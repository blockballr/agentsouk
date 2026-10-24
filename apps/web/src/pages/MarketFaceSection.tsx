import { formatUnits, shortAddress, timeAgo } from '@agora/core'
import { type NotificationRow, type PayeeHire } from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { useSellerData, type HiresSource } from '../lib/seller-data'
import { Dot, Txt, type DotTone } from '../components/souk'
import { SellerStatsStrip } from '../components/SellerStatsStrip'

// only buyers are market face; our checks, the lister's own tests and team wallets stay out
function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
}

function formatHireAmount(hire: PayeeHire): string {
  if (hire.decimals === null) return hire.amount
  try {
    return formatUnits(BigInt(hire.amount), hire.decimals)
  } catch {
    return hire.amount
  }
}

const PEOPLE_SHOWN = 8

// buyers newest first, the recent ones as rows and the earlier ones as a count
function peopleRows(hires: PayeeHire[]): { shown: PayeeHire[]; rest: number } {
  const buyers = (hires ?? [])
    .filter(isCustomer)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return { shown: buyers.slice(0, PEOPLE_SHOWN), rest: Math.max(0, buyers.length - PEOPLE_SHOWN) }
}

// distinct buyers with a settled payment in the window; a hire that never settled counts none
function buyersInWindow(hires: PayeeHire[]): number {
  const since = Date.now() - 14 * 86400000
  const seen = new Set<string>()
  for (const h of hires) {
    if (!isCustomer(h) || h.mode === 'sandbox') continue
    const at = Date.parse(h.createdAt)
    if (Number.isFinite(at) && at >= since) seen.add(h.client.toLowerCase())
  }
  return seen.size
}

function hireTone(h: PayeeHire): DotTone {
  return h.mode === 'sandbox' ? 'quiet' : 'good'
}

// a builder listing settles to its own wallet, so the row names the wallet that
// actually received the payment rather than implying the owner wallet did
function payeeLabel(hire: PayeeHire, account: string | null): string {
  if (account && hire.payTo.toLowerCase() === account.toLowerCase()) return 'your wallet'
  return shortAddress(hire.payTo)
}

export function MarketFaceSection() {
  // money and people come from the same receipts read the console already made
  const {
    account,
    hires,
    hiresSource: source,
    hiresError,
    notifications: feed,
    feedError,
    loading,
  } = useSellerData()

  const all = hires ?? []
  const { shown, rest } = peopleRows(all)
  const buyers14 = buyersInWindow(all)
  // the chain only reads as one when every receipt sits on the same chain
  const chains = new Set(all.map((h) => h.chainId))
  const chain = chains.size === 1 && all.length > 0 ? chainLabel([...chains][0]) : null
  const kicker = account
    ? ['seller / market face', shortAddress(account), chain].filter(Boolean).join(' · ')
    : 'seller / market face'

  return (
    <section
      id="market-face"
      className="mt-16 scroll-mt-24 border-t border-souk-hair pt-12 text-souk-ink"
    >
      <header className="flex w-full flex-col gap-2.5">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h2 className="m-0">
          <Txt size={28} lead={36} display weight="bold" tone="ink">
            People and hires.
          </Txt>
        </h2>
      </header>

      <SellerStatsStrip />

      {account && (
        <>
          {hiresError && (
            <div role="alert" className="mt-6 border-l-2 border-souk-peach pl-3">
              <Txt size={13} lead={20} tone="peach">
                {hiresError}
              </Txt>
            </div>
          )}

          <div className="mt-8 grid min-w-0 gap-0 border-t border-souk-hair lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <PeoplePanel
              shown={shown}
              rest={rest}
              buyers14={buyers14}
              source={source}
              account={account}
            />
            <FeedCard
              rows={feed}
              error={feedError}
              className="mt-8 border-t border-souk-hair pt-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
            />
          </div>

          {loading && hires === null && (
            <Txt size={13} lead={20} tone="muted" className="mt-4 block">
              Reading the receipts store...
            </Txt>
          )}
        </>
      )}

      <div className="mt-10 border-t border-souk-hair" />
    </section>
  )
}

function PeoplePanel({
  shown,
  rest,
  buyers14,
  source,
  account,
}: {
  shown: PayeeHire[]
  rest: number
  buyers14: number
  source: HiresSource
  account: string | null
}) {
  return (
    <div className="min-w-0 pb-6 lg:pr-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-souk-hair py-3">
        <Txt size={15} lead={22} weight="bold" tone="ink">
          Buyers
        </Txt>
        <Txt size={10} lead={14} mono upper tone="labels">
          14 days / {buyers14} {buyers14 === 1 ? 'buyer' : 'buyers'}
        </Txt>
      </div>

      {shown.length === 0 ? (
        <Txt size={13} lead={20} tone="muted" className="block py-5">
          No buyer has hired your agents yet. Their payments appear here.
        </Txt>
      ) : (
        shown.map((h) => (
          <div
            key={h.paymentId}
            className="flex min-w-0 items-start gap-2.5 border-b border-souk-hair/60 py-2.5"
          >
            <Dot tone={hireTone(h)} size={7} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <Txt size={11} lead={16} mono tone="ink" className="truncate">
                  {shortAddress(h.client)}
                </Txt>
                <Txt size={10} lead={14} mono tone="labels" className="shrink-0">
                  {timeAgo(h.createdAt)}
                </Txt>
              </div>
              <Txt size={12} lead={17} tone="slate" className="mt-0.5 block truncate">
                {h.agentName}
              </Txt>
              <Txt size={10} lead={14} mono tone="labels" className="block truncate">
                settled to {payeeLabel(h, account)}
              </Txt>
            </div>
            <div className="shrink-0 text-right">
              <Txt
                size={12}
                lead={17}
                mono
                tone={h.mode === 'sandbox' ? 'steel' : 'data'}
                className="block"
              >
                {formatHireAmount(h)} {h.symbol}
              </Txt>
              {h.mode === 'sandbox' ? (
                <Txt size={9} lead={13} mono tone="steel" className="block">
                  test settlement
                </Txt>
              ) : null}
            </div>
          </div>
        ))
      )}

      <Txt size={12} lead={18} tone="steel" className="mt-3 block">
        {rest > 0
          ? `${rest} earlier ${rest === 1 ? 'hire' : 'hires'} sit below the recent ones.`
          : 'A hire that never settled keeps its row and counts no buyer.'}
      </Txt>
      {source === 'memory' && (
        <Txt size={12} lead={18} tone="steel" className="mt-1 block">
          This server keeps receipts in memory only, so this list may be incomplete.
        </Txt>
      )}
    </div>
  )
}

// the bell's own rows, resurfaced here so the board and the bell can never disagree
function FeedCard({
  rows,
  error,
  className,
}: {
  rows: NotificationRow[] | null
  error: boolean
  className?: string
}) {
  const shown = (rows ?? []).slice(0, 4)
  const line = (n: NotificationRow) => (
    <div key={n.id} className="border-b border-souk-hair/60 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Dot tone={n.read ? 'quiet' : 'sky'} size={7} />
        <div className="min-w-0">
          <Txt size={12} lead={17} tone="slate" className="block">
            {n.title}
          </Txt>
          <Txt size={10} lead={14} mono tone="labels" className="mt-0.5 block">
            {timeAgo(n.createdAt)}
          </Txt>
        </div>
      </div>
    </div>
  )
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-souk-hair py-3">
        <Txt size={15} lead={22} weight="bold" tone="ink">
          Signals
        </Txt>
        <Txt size={10} lead={14} mono upper tone="labels">
          Same feed as the bell
        </Txt>
      </div>
      {error ? (
        <Txt size={13} lead={20} tone="muted" className="block py-5">
          The bell could not be read just now.
        </Txt>
      ) : shown.length === 0 ? (
        <Txt size={13} lead={20} tone="muted" className="block py-5">
          {rows === null
            ? 'Reading the bell...'
            : 'Nothing yet. Hires, verdicts and runner alerts land in the bell and here.'}
        </Txt>
      ) : (
        shown.map(line)
      )}
    </div>
  )
}
