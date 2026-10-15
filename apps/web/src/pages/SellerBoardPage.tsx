import { useCallback, useEffect, useState } from 'react'
import { formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  getAgents,
  getAgentsByOwner,
  getHiresByPayee,
  type OwnedAgentsResult,
  type PayeeHire,
} from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { countByDay } from '../lib/history'
import { verdictFor } from '../lib/verdict'
import { connectWallet } from '../lib/wallet'
import { useActiveAccount } from '../lib/use-active-account'
import { Btn, Dot, Kpi, Pill, Row, Rule, SectionHead, Stack, Txt } from '../components/souk'

type HiresSource = 'postgres' | 'memory' | null
type Catalogue = Awaited<ReturnType<typeof getAgents>>

const DAY = 86_400_000

// a hire paid by a buyer, as opposed to our checks, the lister's own tests or a team wallet
function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
}

// real settlements only, summed per chain and asset the way the profile page
// reads them, so a sandbox receipt never counts as money and one chain's
// decimals never join another's
function earnedLabel(list: PayeeHire[]): string {
  const totals = new Map<string, { symbol: string; raw: bigint; decimals: number | null; count: number }>()
  for (const h of list) {
    if (h.mode === 'sandbox') continue
    let raw: bigint
    try {
      raw = BigInt(h.amount)
    } catch {
      // an unreadable amount is left out rather than guessed
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

// count a window of customer hires by when they settled, dates that will not
// parse counting as nothing
function countWindow(list: PayeeHire[], fromMs: number, toMs: number): number {
  let n = 0
  for (const h of list) {
    const t = Date.parse(h.createdAt)
    if (Number.isFinite(t) && t >= fromMs && t < toMs) n += 1
  }
  return n
}

// the newest check any of the wallet's own listings carries: the only sweep
// clock a client read can prove, since the cron staleness route is secret gated
function latestCheckedAt(owned: OwnedAgentsResult | null): string | null {
  let latest: number | null = null
  for (const a of owned?.agents ?? []) {
    if (a.delisted || !a.verification) continue
    const t = Date.parse(a.verification.checkedAt)
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t
  }
  return latest === null ? null : new Date(latest).toISOString()
}

// the freshest time the catalogue tool names: the store's refresh when it
// claims one, else the snapshot or the top-up, so a date is never older than
// the source the server actually attests
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

export function SellerBoardPage() {
  // the seller's wallet, watched so a switch inside the wallet re-reads the board
  const account = useActiveAccount()
  const [connecting, setConnecting] = useState(false)
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      setCatalogue(null)
      setReady(false)
      return
    }
    setLoading(true)
    setError(null)
    // three independent reads, so a receipts outage must not hide the listings
    // and a catalogue outage must not hide the money
    const [ownedResult, hiresResult, catResult] = await Promise.allSettled([
      getAgentsByOwner(account),
      getHiresByPayee(account),
      getAgents({ limit: 1 }),
    ])
    if (ownedResult.status === 'fulfilled') setOwned(ownedResult.value)
    else setOwned(null)
    if (hiresResult.status === 'fulfilled') {
      setHires(hiresResult.value.hires)
      setHiresSource(hiresResult.value.source)
    } else {
      setHires(null)
      setHiresSource(null)
    }
    setCatalogue(catResult.status === 'fulfilled' ? catResult.value : null)
    const failed = ownedResult.status === 'rejected' && hiresResult.status === 'rejected'
    setError(
      failed
        ? hireErrorText(ownedResult.status === 'rejected' ? ownedResult.reason : hiresResult.reason)
        : null,
    )
    setLoading(false)
    setReady(true)
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  async function onConnect() {
    setConnecting(true)
    try {
      void connectWallet()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  const customers = (hires ?? []).filter(isCustomer)
  const now = Date.now()
  const recent = countWindow(customers, now - 14 * DAY, now + DAY)
  const previous = countWindow(customers, now - 28 * DAY, now - 14 * DAY)
  // only a failed last check makes the quiet list: delivered and gated listings
  // still answer the board, and off market ones already carry their own flag
  const runners = (owned?.agents ?? [])
    .filter(
      (a) =>
        !a.delisted &&
        (a.verification?.status === 'dead' || a.verification?.status === 'unreachable'),
    )
    .sort((a, b) =>
      Date.parse(b.verification?.checkedAt ?? '') - Date.parse(a.verification?.checkedAt ?? ''),
    )
  const chainId = catalogue?.chainId ?? owned?.chainId ?? null
  const checkedAt = latestCheckedAt(ready ? owned : null)
  const catFresh = catalogueFreshness(ready ? catalogue : null)

  const kicker = [
    account ? 'SELLER' : 'SELLER BOARD',
    account ? `WALLET ${shortAddress(account)}` : null,
    chainId ? `${chainLabel(chainId).toUpperCase()} ${chainId}` : null,
    'BOARD A',
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  const kpis: { value: string; label: string; tone: 'data' | 'white' }[] = [
    {
      value: hires ? earnedLabel(customers) : 'Unavailable',
      label: 'Earned, settled only',
      tone: customers.length === 0 ? 'white' : 'data',
    },
    {
      value: `${recent}`,
      label: 'Buyer hires, 14 days',
      tone: recent === 0 ? 'white' : 'data',
    },
    {
      value: checkedAt ? timeAgo(checkedAt) : 'Unavailable',
      label: 'Since your listings were last checked',
      tone: 'data',
    },
    {
      value: catFresh ? timeAgo(catFresh) : 'Unavailable',
      label: 'Catalogue refreshed',
      tone: 'data',
    },
  ]

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      <Stack gap={10} className="max-w-[1280px] xl:max-w-[min(1280px,calc(100%_-_460px))]">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Your board.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          What the market did while you were away: settled money, buyer hires, and the
          listings that failed their last check. Nothing here is projected.
        </Txt>
      </Stack>

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you list with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            A board is built from that wallet&apos;s own listings and the receipts paid to them.
          </Txt>
          <Btn kind="primary" onClick={() => void onConnect()} disabled={connecting} className="mt-2 self-start">
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </Btn>
        </Stack>
      )}

      {account && ready && !loading && (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => (
              <Kpi key={k.label} value={k.value} label={k.label} tone={k.tone} />
            ))}
          </div>

          {hiresSource === 'memory' && (
            <Row
              justify="between"
              align="center"
              gap={12}
              pad={[14, 16, 14, 16]}
              radius={8}
              bg="indigo"
              hair
              className="mt-5 flex-wrap"
            >
              <Row align="center" gap={10}>
                <Dot tone="sky" size={8} />
                <Txt size={13} lead={18} tone="ink" className="min-w-0">
                  This server keeps receipts in memory only. Hires still settle, and the
                  earned figure above is behind what the chain has settled.
                </Txt>
              </Row>
              <Btn kind="off" onClick={() => void load()} disabled={loading}>
                RE-RUN NOW
              </Btn>
            </Row>
          )}

          <div className="mt-5 flex flex-wrap items-stretch gap-5">
            <Stack surface pad={[16, 16, 14, 16]} gap={10} className="min-w-[620px] flex-[3_1_680px]">
              <SectionHead title="Runners gone quiet" note="ONE ALERT WHEN A LISTING GOES QUIET" />
              {owned
                ? owned.agents.length === 0
                  ? (
                    <Txt size={12} lead={18} tone="steel" className="py-3">
                      This wallet lists nothing on this chain yet.
                    </Txt>
                  )
                  : runners.length === 0
                    ? (
                      <Txt size={12} lead={18} tone="steel" className="py-3">
                        None of your listings failed their last check.
                      </Txt>
                    )
                    : runners.map((a) => (
                      <Row
                        key={`${a.chainId}:${a.tokenId}`}
                        align="center"
                        gap={10}
                        style={{ height: 34 }}
                      >
                        <Row align="center" gap={9} className="min-w-0 flex-1">
                          <Dot tone="sky" size={8} />
                          <Txt size={13} lead={18} weight="semibold" tone="ink" className="min-w-0 truncate">
                            <a
                              href={`/agents/${a.chainId}/${a.tokenId}`}
                              title={verdictFor(a.chainId, a.verification).explain}
                              className="transition hover:text-souk-white"
                            >
                              {a.name}
                            </a>
                          </Txt>
                        </Row>
                        <Txt size={11} lead={16} mono tone="slate" className="shrink-0 truncate">
                          {chainLabel(a.chainId)}
                        </Txt>
                        <Txt size={11} lead={16} mono tone="labels" className="shrink-0 truncate">
                          checked {a.verification ? timeAgo(a.verification.checkedAt) : 'never'}
                        </Txt>
                        <Pill variant="warn">{verdictFor(a.chainId, a.verification).label}</Pill>
                      </Row>
                    ))
                : (
                  <Txt size={12} lead={18} tone="steel" className="py-3">
                    The owner read could not be reached just now.
                  </Txt>
                )}
              <Txt size={12} lead={18} tone="steel">
                A quiet runner does not stop hires. It stops the board claiming the listings
                are alive.
              </Txt>
            </Stack>

            <Stack surface pad={[16, 16, 14, 16]} gap={12} className="min-w-[520px] flex-[2_1_520px]">
              <SectionHead title="Hires by day" note="14 DAYS" />
              {hires ? (
                <>
                  <Row align="end" gap={8} style={{ height: 96 }}>
                    {countByDay(customers.map((h) => h.createdAt)).map((d) => {
                      const empty = d.count === 0
                      return (
                        <span
                          key={d.day}
                          title={`${d.day}: ${d.count}`}
                          className={empty ? 'min-w-0 flex-1 rounded-[3px] bg-souk-surface2' : 'min-w-0 flex-1 rounded-[3px] bg-souk-data'}
                          style={{ height: Math.min(96, Math.max(6, d.count * 7)), opacity: empty ? undefined : 0.35 + Math.min(0.6, d.count / 20) }}
                        />
                      )
                    })}
                  </Row>
                  <Txt size={12} lead={18} tone="steel">
                    {recent === 0 && previous === 0
                      ? 'No buyer hires landed in either fortnight yet.'
                      : `${recent} ${recent === 1 ? 'hire' : 'hires'} in this window, against ${previous} in the one before it.`}
                  </Txt>
                </>
              ) : (
                <Txt size={12} lead={18} tone="steel" className="py-6">
                  The receipts read could not be reached just now.
                </Txt>
              )}
            </Stack>
          </div>
        </>
      )}

      {error && (
        <div role="alert" className="mt-6">
          <Stack pad={[14, 16, 14, 16]} radius={14} hair>
            <Txt size={13} lead={20} tone="peach">
              {error}
            </Txt>
          </Stack>
        </div>
      )}

      <Stack gap={8} className="mt-5">
        <Rule />
        <Txt size={12} lead={18} tone="muted" className="block max-w-[1180px]">
          A listing that has gone quiet keeps its hires and loses only its claim to being alive.
        </Txt>
      </Stack>
    </div>
  )
}
