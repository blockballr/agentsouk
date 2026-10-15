import { useCallback, useEffect, useState } from 'react'
import { formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  getHiresByPayee,
  getNotifications,
  type NotificationRow,
  type PayeeHire,
} from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { connectWallet, getActiveAccount } from '../lib/wallet'
import { Btn, Dot, Pill, Row, Rule, Stack, Txt, type DotTone } from '../components/souk'

type HiresSource = 'postgres' | 'memory' | null

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

interface EarnedRow {
  key: string
  asset: string
  count: number
  amount: string
  // a plain phrase when the asset's decimals are unknown, so no raw base units read as money
  plain: boolean
  when: string
}

// settled receipts only, summed per chain and asset, since $U on one chain never earns
// its way into sUSD on another
function earnedRows(hires: PayeeHire[]): EarnedRow[] {
  const totals = new Map<
    string,
    { symbol: string; chainId: number; raw: bigint; decimals: number | null; count: number; last: string }
  >()
  for (const h of hires) {
    if (h.mode === 'sandbox') continue
    const key = `${h.chainId}:${h.symbol}`
    const entry =
      totals.get(key) ?? { symbol: h.symbol, chainId: h.chainId, raw: BigInt(0), decimals: h.decimals, count: 0, last: h.createdAt }
    try {
      entry.raw += BigInt(h.amount)
    } catch {
      // an unreadable amount is skipped rather than guessed at
    }
    if (entry.decimals === null && h.decimals !== null) entry.decimals = h.decimals
    entry.count += 1
    if (Date.parse(h.createdAt) > Date.parse(entry.last)) entry.last = h.createdAt
    totals.set(key, entry)
  }
  return [...totals.values()].map((e) => ({
    key: `${e.chainId}:${e.symbol}`,
    asset: `${chainLabel(e.chainId)} · ${e.symbol}`,
    count: e.count,
    amount: e.decimals !== null ? formatUnits(e.raw, e.decimals) : `${e.count} ${e.symbol} payments`,
    plain: e.decimals === null,
    when: timeAgo(e.last),
  }))
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

export function MarketFacePage() {
  const [account, setAccount] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [source, setSource] = useState<HiresSource>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)
  const [feed, setFeed] = useState<NotificationRow[] | null>(null)
  const [feedError, setFeedError] = useState(false)

  useEffect(() => {
    void getActiveAccount().then(setAccount)
  }, [])

  const load = useCallback(async () => {
    if (!account) {
      setHires(null)
      setSource(null)
      setFeed(null)
      return
    }
    setLoading(true)
    setHiresError(null)
    setFeedError(false)
    // the two reads are independent, so an outage in the bell must not hide the receipts
    const [payee, bell] = await Promise.allSettled([getHiresByPayee(account), getNotifications(account)])
    if (payee.status === 'fulfilled') {
      setHires(payee.value.hires)
      setSource(payee.value.source)
    } else {
      setHires(null)
      setSource(null)
      setHiresError(hireErrorText(payee.reason))
    }
    if (bell.status === 'fulfilled') {
      setFeed(bell.value.rows)
    } else {
      setFeed(null)
      setFeedError(true)
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  async function onConnect() {
    setConnecting(true)
    try {
      setAccount(await connectWallet())
    } catch (e) {
      setHiresError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  const all = hires ?? []
  const earned = earnedRows(all)
  const { shown, rest } = peopleRows(all)
  const buyers14 = buyersInWindow(all)
  // the chain only reads as one when every receipt sits on the same chain
  const chains = new Set(all.map((h) => h.chainId))
  const chain = chains.size === 1 && all.length > 0 ? chainLabel([...chains][0]) : null
  const kicker = account
    ? ['profile / market face', shortAddress(account), chain].filter(Boolean).join(' · ')
    : 'profile / market face'
  const read = hires !== null

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      <header className="flex max-w-[1180px] flex-col gap-2.5 xl:max-w-[min(1180px,calc(100%_-_460px))]">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Money and people.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          What you earned and who paid for it on one surface. Settled receipts only, and an asset with
          nothing settled says so instead of showing a figure.
        </Txt>
      </header>

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you listed with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            A market face reads the receipts store for the wallet your agents settle to.
          </Txt>
          <Btn kind="primary" onClick={onConnect} disabled={connecting} className="mt-2 self-start">
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </Btn>
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

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <EarnedPanel rows={earned} read={read} />
            <PeoplePanel shown={shown} rest={rest} buyers14={buyers14} source={source} />
          </div>

          <FeedCard rows={feed} error={feedError} className="mt-5" />

          {loading && !read && (
            <Txt size={13} lead={20} tone="muted" className="mt-4 block">
              Reading the receipts store...
            </Txt>
          )}
        </>
      )}

      <div className="mt-10">
        <Rule />
      </div>
    </div>
  )
}

// the indigo panel, the one surface a figure is allowed to sit on, and the settlement
// read per asset, never per mood
function EarnedPanel({ rows, read }: { rows: EarnedRow[]; read: boolean }) {
  return (
    <Stack bg="indigo" hair radius={20} pad={[16, 16, 14, 16]} gap={12} className="min-w-0">
      <Row justify="between" align="center" gap={9}>
        <Txt size={15} lead={22} weight="bold" tone="ink">
          Earned
        </Txt>
        <Txt size={10} lead={14} weight="bold" upper tone="labels">
          Settled only
        </Txt>
      </Row>
      {rows.length === 0 ? (
        <Row justify="between" align="center" gap={10}>
          <Txt size={12} lead={18} tone={read ? 'slate' : 'muted'}>
            {read ? 'No settled payment on any asset yet.' : 'Waiting for the receipts store.'}
          </Txt>
          {read ? (
            <Txt size={15} lead={20} mono tone="muted">
              nothing yet
            </Txt>
          ) : null}
        </Row>
      ) : (
        rows.map((row) => (
          <Row key={row.key} justify="between" align="center" gap={10} className="min-w-0">
            <Row align="center" gap={10} className="min-w-0">
              <Pill>{row.asset}</Pill>
              <Txt size={12} lead={18} tone="slate" className="truncate">
                {row.count === 1 ? '1 settlement' : `${row.count} settlements`}
              </Txt>
            </Row>
            <Row align="center" gap={10} className="shrink-0">
              <Txt size={15} lead={20} mono tone={row.plain ? 'slate' : 'data'}>
                {row.amount}
              </Txt>
              <Txt size={11} lead={16} mono tone="labels">
                {row.when}
              </Txt>
            </Row>
          </Row>
        ))
      )}
      <Txt size={12} lead={18} tone="slate">
        Sandbox receipts never land here. Every figure is read off a settled payment.
      </Txt>
    </Stack>
  )
}

function PeoplePanel({
  shown,
  rest,
  buyers14,
  source,
}: {
  shown: PayeeHire[]
  rest: number
  buyers14: number
  source: HiresSource
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
          <Row key={h.paymentId} align="center" gap={10} className="min-h-[34px] min-w-0">
            <Dot tone={hireTone(h)} size={8} />
            <Txt size={12} lead={18} mono tone="ink" className="w-[150px] shrink-0 truncate">
              {shortAddress(h.client)}
            </Txt>
            <Txt size={13} lead={18} tone="slate" className="min-w-0 flex-1 truncate">
              {h.agentName}
            </Txt>
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
