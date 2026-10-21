import { formatUnits, shortAddress, timeAgo } from '@agora/core'
import { type OwnedAgentsResult, type PayeeHire } from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { countByDay } from '../lib/history'
import { verdictFor } from '../lib/verdict'
import { type Catalogue, useSellerData } from '../lib/seller-data'
import { EarningsPanel } from '../components/EarningsPanel'
import { Btn, Dot, Kpi, Pill, Row, Rule, SectionHead, Stack, Txt } from '../components/souk'

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

export function SellerBoardSection() {
  // the seller's wallet and every read behind the three boards, loaded once by
  // the console and shared here
  const { account, owned, hires, hiresSource, catalogue, views, loading, ready, error, reload } =
    useSellerData()

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
    'seller / board',
    account ? `wallet ${shortAddress(account)}` : null,
    chainId ? `${chainLabel(chainId).toUpperCase()} ${chainId}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')

  const kpis: { value: string; label: string; tone: 'indigo-data' | 'white' }[] = [
    {
      value: hires ? earnedLabel(customers) : 'Unavailable',
      label: 'Earned, settled only',
      tone: customers.length === 0 ? 'white' : 'indigo-data',
    },
    {
      value: `${recent}`,
      label: 'Buyer hires, 14 days',
      tone: recent === 0 ? 'white' : 'indigo-data',
    },
    {
      value: views === null ? 'Unavailable' : `${views}`,
      label: 'Impressions, 14 days',
      tone: views ? 'indigo-data' : 'white',
    },
    {
      value: checkedAt ? timeAgo(checkedAt) : 'Unavailable',
      label: 'Since your listings were last checked',
      tone: 'indigo-data',
    },
    {
      value: catFresh ? timeAgo(catFresh) : 'Unavailable',
      label: 'Catalogue refreshed',
      tone: 'indigo-data',
    },
  ]

  return (
    <section id="board" className="scroll-mt-24 text-souk-ink">
      <Stack gap={10} className="max-w-[1280px] xl:max-w-[min(1280px,calc(100%_-_460px))]">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Your board.
          </Txt>
        </h1>
      </Stack>

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you list with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            A board is built from that wallet&apos;s own listings and the receipts paid to them.
          </Txt>
          <Txt size={12} lead={18} tone="steel">
            Connect from the rail on the left, or the bar above on a narrow screen.
          </Txt>
        </Stack>
      )}

      {account && ready && !loading && (
        <>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
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
                <Txt size={13} lead={18} tone="white" className="min-w-0">
                  This server keeps receipts in memory only. Hires still settle, and the
                  earned figure above is behind what the chain has settled.
                </Txt>
              </Row>
              <Btn kind="off" onClick={() => void reload()} disabled={loading}>
                RE-RUN NOW
              </Btn>
            </Row>
          )}

          <div className="mt-5">
            <EarningsPanel hires={hires} chainId={chainId} />
          </div>

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
                  <Row align="end" gap={4} style={{ height: 96 }}>
                    {countByDay(customers.map((h) => h.createdAt)).map((d) => {
                      const empty = d.count === 0
                      return (
                        <span key={d.day} className="flex h-full min-w-0 flex-1 items-end justify-center">
                          <span
                            title={`${d.day}: ${d.count}`}
                            className={`w-[7px] rounded-[2px] ${empty ? 'bg-souk-surface2' : 'bg-souk-data'}`}
                            style={{
                              height: Math.min(96, Math.max(empty ? 4 : 6, d.count * 7)),
                              opacity: empty ? undefined : 0.35 + Math.min(0.6, d.count / 20),
                            }}
                          />
                        </span>
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
    </section>
  )
}
