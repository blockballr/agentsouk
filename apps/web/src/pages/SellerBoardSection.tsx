import { shortAddress, timeAgo } from '@agora/core'
import { type PayeeHire } from '../lib/api'
import { chainLabel } from '../lib/contracts'
import { countByDay } from '../lib/history'
import { verdictFor } from '../lib/verdict'
import { useSellerData } from '../lib/seller-data'
import { EarningsPanel } from '../components/EarningsPanel'
import { Btn, Dot, Pill, Row, Rule, SectionHead, Stack, Txt } from '../components/souk'

const DAY = 86_400_000

// a hire paid by a buyer, as opposed to our checks, the lister's own tests or a team wallet
function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
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

export function SellerBoardSection() {
  // the seller's wallet and every read behind the three boards, loaded once by
  // the console and shared here
  const { account, owned, hires, hiresSource, catalogue, loading, ready, error, reload } =
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
  // the chart starts on the day the seller's first listing was minted, whether
  // that listing came through the wizard or the builder
  const firstListedAt =
    (owned?.agents ?? [])
      .map((a) => a.createdAt)
      .filter((t): t is string => Boolean(t))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null

  const kicker = [
    'seller / portfolio',
    account ? `wallet ${shortAddress(account)}` : null,
    chainId ? `${chainLabel(chainId).toUpperCase()} ${chainId}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ')


  return (
    <section id="board" className="scroll-mt-24 text-souk-ink">
      <Stack gap={10} className="w-full">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Portfolio.
          </Txt>
        </h1>
      </Stack>

      {!account && (
        <div className="mt-8 max-w-[680px] border-y border-souk-hair py-5">
          <Txt size={15} lead={22} tone="ink" className="block">
            Connect the wallet you list with.
          </Txt>
          <Txt size={13} lead={20} tone="muted" className="mt-1 block">
            A board is built from that wallet&apos;s own listings and the receipts paid to them.
          </Txt>
          <Txt size={12} lead={18} tone="steel" className="mt-2 block">
            Connect from the rail on the left, or the bar above on a narrow screen.
          </Txt>
        </div>
      )}

      {account && ready && !loading && (
        <>
          <div className="mt-6">
            <EarningsPanel
              hires={hires}
              chainId={chainId}
              listedAt={firstListedAt}
              agents={owned?.agents ?? []}
            />
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

          <div className="mt-8 grid min-w-0 gap-0 border-y border-souk-hair lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="min-w-0 py-5 lg:pr-6">
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
            </section>

            <section className="min-w-0 border-t border-souk-hair py-5 lg:border-l lg:border-t-0 lg:pl-6">
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
            </section>
          </div>
        </>
      )}

      {error && (
        <div role="alert" className="mt-6 border-l-2 border-souk-peach pl-3">
          <Txt size={13} lead={20} tone="peach">
            {error}
          </Txt>
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
