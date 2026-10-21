import { formatUnits, shortAddress, timeAgo } from '@agora/core'
import { type NotificationRow, type PayeeHire } from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { useSellerData, type HiresSource } from '../lib/seller-data'
import { Dot, Row, Rule, Stack, Txt, type DotTone } from '../components/souk'
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
  return h.mode === 'sandbox' ? 'held' : 'good'
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
      <header className="flex max-w-[1180px] flex-col gap-2.5 xl:max-w-[min(1180px,calc(100%_-_460px))]">
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

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you listed with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            The buyers your agents settled, and the activity around them.
          </Txt>
          <Txt size={12} lead={18} tone="steel">
            Connect from the rail on the left, or the bar above on a narrow screen.
          </Txt>
        </Stack>
      )}

      {account && (
        <>
          {hiresError && (
            <div role="alert" className="mt-6">
              <Stack pad={[14, 16, 14, 16]} radius={14} hair>
                <Txt size={13} lead={20} tone="peach">
                  {hiresError}
                </Txt>
              </Stack>
            </div>
          )}

          <div className="mt-6 max-w-[820px]">
            <PeoplePanel
              shown={shown}
              rest={rest}
              buyers14={buyers14}
              source={source}
              account={account}
            />
          </div>

          <FeedCard rows={feed} error={feedError} className="mt-5" />

          {loading && hires === null && (
            <Txt size={13} lead={20} tone="muted" className="mt-4 block">
              Reading the receipts store...
            </Txt>
          )}
        </>
      )}

      <div className="mt-10">
        <Rule />
      </div>
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
    <Stack surface pad={[16, 16, 14, 16]} gap={10} className="min-w-0">
      <Row justify="between" align="center" gap={9}>
        <Txt size={15} lead={22} weight="bold" tone="ink">
          The people
        </Txt>
        <Txt size={10} lead={14} mono upper tone="labels">
          14 days · {buyers14} {buyers14 === 1 ? 'buyer' : 'buyers'}
        </Txt>
      </Row>
      {shown.length === 0 ? (
        <Txt size={13} lead={20} tone="muted">
          No buyer has hired your agents yet. Their payments appear here.
        </Txt>
      ) : (
        shown.map((h) => (
          <Row key={h.paymentId} align="center" gap={10} className="min-h-[38px] min-w-0">
            <Dot tone={hireTone(h)} size={8} />
            <Txt size={12} lead={18} mono tone="ink" className="w-[150px] shrink-0 truncate">
              {shortAddress(h.client)}
            </Txt>
            <div className="min-w-0 flex-1">
              <Txt size={13} lead={18} tone="slate" className="block truncate">
                {h.agentName}
              </Txt>
              <Txt size={10} lead={14} mono tone="labels" className="block truncate">
                settled to {payeeLabel(h, account)}
              </Txt>
            </div>
            <Txt
              size={13}
              lead={18}
              mono
              tone={h.mode === 'sandbox' ? 'steel' : 'data'}
              className="w-[160px] shrink-0 truncate text-right"
            >
              {formatHireAmount(h)} {h.symbol}
            </Txt>
            <Txt size={11} lead={16} mono tone="labels" className="shrink-0">
              {timeAgo(h.createdAt)}
              {h.mode === 'sandbox' ? ' · test settlement' : ''}
            </Txt>
          </Row>
        ))
      )}
      <Txt size={12} lead={18} tone="steel">
        {rest > 0
          ? `${rest} earlier ${rest === 1 ? 'hire' : 'hires'} sit below the recent ones.`
          : 'A hire that never settled keeps its row and counts no buyer.'}
      </Txt>
      {source === 'memory' && (
        <Txt size={12} lead={18} tone="steel">
          This server keeps receipts in memory only, so this list may be incomplete.
        </Txt>
      )}
    </Stack>
  )
}

// the bell's own rows, resurfaced here so the board and the bell can never disagree
function FeedCard({ rows, error, className }: { rows: NotificationRow[] | null; error: boolean; className?: string }) {
  const shown = (rows ?? []).slice(0, 4)
  const left = shown.slice(0, 2)
  const right = shown.slice(2, 4)
  const line = (n: NotificationRow) => (
    <Row key={n.id} align="center" gap={9} className="min-w-0">
      <Dot tone={n.read ? 'quiet' : 'sky'} size={8} />
      <Stack gap={2} className="min-w-0">
        <Txt size={13} lead={18} tone="slate" className="truncate">
          {n.title}
        </Txt>
        <Txt size={11} lead={15} mono tone="labels">
          {timeAgo(n.createdAt)}
        </Txt>
      </Stack>
    </Row>
  )
  return (
    <Stack surface pad={[16, 16, 14, 16]} gap={10} className={className}>
      <Row justify="between" align="center" gap={9}>
        <Txt size={15} lead={22} weight="bold" tone="ink">
          The same feed as the bell
        </Txt>
        <Txt size={10} lead={14} mono upper tone="labels">
          Reads either place
        </Txt>
      </Row>
      {error ? (
        <Txt size={13} lead={20} tone="muted">
          The bell could not be read just now.
        </Txt>
      ) : shown.length === 0 ? (
        <Txt size={13} lead={20} tone="muted">
          {rows === null
            ? 'Reading the bell...'
            : 'Nothing yet. Hires, verdicts and runner alerts land in the bell and here.'}
        </Txt>
      ) : (
        <div className="flex flex-wrap gap-8">
          <Stack gap={10} className="min-w-0 flex-1">
            {left.map(line)}
          </Stack>
          <Stack gap={10} className="min-w-0 flex-1">
            {right.map(line)}
          </Stack>
        </div>
      )}
    </Stack>
  )
}
