import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  getAgentsByOwner,
  getHiresByPayee,
  recheckAgent,
  type OwnedAgent,
  type OwnedAgentsResult,
  type PayeeHire,
} from '../lib/api'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { VERDICT_DOT, verdictFor } from '../lib/verdict'
import { connectWallet, getActiveAccount } from '../lib/wallet'
import { Action, LABEL, TextSlot, button, card, cx } from '../components/ui'

type HiresSource = 'postgres' | 'memory' | null

function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? (key === 'general' ? 'General' : key)
}

// a buyer's hire, as opposed to our own checks, the lister's test hires or a team wallet
function isCustomer(h: PayeeHire): boolean {
  return !h.payer || h.payer === 'buyer'
}

// a stored amount is raw base units; format it only when the asset's decimals are known
function formatHireAmount(hire: PayeeHire): string {
  if (hire.decimals === null) return hire.amount
  try {
    return formatUnits(BigInt(hire.amount), hire.decimals)
  } catch {
    return hire.amount
  }
}

// real settlements only, summed per chain and asset, so a sandbox receipt never counts as
// money and U on one chain never adds into sUSD on another
function earnedLabel(list: PayeeHire[]): string {
  const totals = new Map<string, { symbol: string; raw: bigint; decimals: number | null; count: number }>()
  for (const h of list) {
    if (h.mode === 'sandbox') continue
    const key = `${h.chainId}:${h.symbol}`
    const entry = totals.get(key) ?? { symbol: h.symbol, raw: BigInt(0), decimals: h.decimals, count: 0 }
    try {
      entry.raw += BigInt(h.amount)
    } catch {
      // an unreadable amount is left out rather than guessed
    }
    entry.count += 1
    totals.set(key, entry)
  }
  if (totals.size === 0) return 'nothing yet'
  return [...totals.values()]
    .map((e) => (e.decimals === null ? `${e.count} ${e.symbol} payments` : `${formatUnits(e.raw, e.decimals)} ${e.symbol}`))
    .join(' + ')
}

// a memory-mode store only knows what this instance recorded, so a total from it is a
// floor rather than the truth; a durable zero is a real zero
function receivedLabel(received: number, source: HiresSource): string {
  if (source === 'postgres') return String(received)
  if (source === 'memory') return received > 0 ? `${received} seen here` : 'Unavailable here'
  return 'Unavailable'
}

export function ProfilePage() {
  const [account, setAccount] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)

  useEffect(() => {
    void getActiveAccount().then(setAccount)
  }, [])

  const load = useCallback(async () => {
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      return
    }
    setLoading(true)
    setError(null)
    setHiresError(null)
    // the two reads are independent, so a receipts outage must not hide the listings
    const [ownedResult, hiresResult] = await Promise.allSettled([
      getAgentsByOwner(account),
      getHiresByPayee(account),
    ])
    if (ownedResult.status === 'fulfilled') {
      setOwned(ownedResult.value)
    } else {
      setError(hireErrorText(ownedResult.reason))
    }
    if (hiresResult.status === 'fulfilled') {
      setHires(hiresResult.value.hires)
      setHiresSource(hiresResult.value.source)
    } else {
      setHires(null)
      setHiresSource(null)
      setHiresError(hireErrorText(hiresResult.reason))
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  async function onConnect() {
    setConnecting(true)
    try {
      const addr = await connectWallet()
      setAccount(addr)
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  const agents = owned?.agents ?? []
  // only buyers count as hires received; our checks and self-tests would inflate it
  const customerHires = (hires ?? []).filter(isCustomer)
  const byToken = new Map<string, PayeeHire[]>()
  for (const h of customerHires) {
    const key = `${h.chainId}:${h.tokenId}`
    byToken.set(key, [...(byToken.get(key) ?? []), h])
  }
  const settledChain = hires?.[0]?.chainId ?? owned?.chainId ?? null

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Your profile</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
          Your listings.
        </h1>
        {account && owned && (
          <div className="flex flex-wrap gap-6 text-[13px] text-newsprint-gray">
            <span>
              <strong className="text-press-black">{owned.counts.agents}</strong>{' '}
              {owned.counts.agents === 1 ? 'listing' : 'listings'}
            </span>
            {hiresSource === 'postgres' && hires && (
              <>
                <span>
                  <strong className="text-press-black">{customerHires.length}</strong>{' '}
                  {customerHires.length === 1 ? 'buyer hire' : 'buyer hires'}
                </span>
                <span>
                  earned <strong className="text-press-black">{earnedLabel(customerHires)}</strong>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        What you have listed, whether it answers our checks, and who has hired it.
      </p>

      {!account && (
        <div className="mt-10 metal rounded-[14px] border hairline border-slate-verdant/40 p-10">
          <p className="text-[15px] text-typesetter-ink">
            Connect the wallet you listed with.
          </p>
          <p className="mt-2 text-[13px] text-newsprint-gray">
            A listing belongs to the wallet the registry records as its owner.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className={cx(button('primary', 'md'), 'mt-6')}
          >
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </button>
        </div>
      )}

      {account && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="micro text-newsprint-gray">
              Showing listings for{' '}
              <span className="font-mono text-press-black">{shortAddress(account)}</span>
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className={button('secondary', 'sm')}
            >
              {loading ? 'Reading...' : 'Refresh'}
            </button>
          </div>

          {error && (
            <p className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
              {error}
            </p>
          )}

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {owned && agents.length === 0 && (
              <div className={cx(card('plain', 'xl'), 'md:col-span-2 lg:col-span-3')}>
                <p className="text-[15px] text-newsprint-gray">
                  This wallet owns no listed agents on this chain yet.
                </p>
                <p className="mt-2 text-[13px] text-newsprint-gray/80">
                  Just registered? The catalogue reads the chain again within a minute, and a listing shows once it has an endpoint we can call.
                </p>
                <Action variant="primary" size="md" to="/list" className="mt-6">
                  List an agent
                </Action>
              </div>
            )}

            {agents.map((agent) => (
              <OwnedAgentCard
                key={`${agent.chainId}:${agent.tokenId}`}
                agent={agent}
                received={byToken.get(`${agent.chainId}:${agent.tokenId}`)?.length ?? 0}
                earned={earnedLabel(byToken.get(`${agent.chainId}:${agent.tokenId}`) ?? [])}
                source={hiresSource}
                onChanged={() => void load()}
              />
            ))}
          </div>

          <HiresPanel
            hires={hires}
            source={hiresSource}
            error={hiresError}
            chainId={settledChain}
          />

          <div className="mt-16 metal rounded-[14px] border hairline border-highlighter-green/50 bg-highlighter-green/5 p-8">
            <h2 className="font-serif text-2xl font-medium">List another agent</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-newsprint-gray">
              One transaction from your wallet registers it, with you as the owner.
            </p>
            <Link
              to="/list"
              className={cx(button('primary', 'lg'), 'mt-6')}
            >
              Open the listing wizard
            </Link>
          </div>
        </>
      )}
    </section>
  )
}

// the one note a card has room for, most urgent first; every note fits the two-line slot
function cardNote(agent: OwnedAgent): string {
  if (agent.failingSince) {
    // the sweep runs daily, so a listing can be past day 7 for a few hours before it is removed
    const days = Math.min(7, Math.max(0, Math.floor((Date.now() - Date.parse(agent.failingSince)) / 86400000)))
    return `Not answering for ${days} of 7 days. One delivered check resets the clock.`
  }
  const quality = agent.verification?.quality
  return quality ? `Graded ${quality.grade}: ${quality.reason}` : ''
}

// every listing is built from the same parts in the same order at a fixed height, so a row
// of cards reads evenly and the actions line up along the bottom
function OwnedAgentCard({
  agent,
  received,
  earned,
  source,
  onChanged,
}: {
  agent: OwnedAgent
  received: number
  earned: string
  source: HiresSource
  onChanged: () => void
}) {
  const agentHref = `/agents/${agent.chainId}/${agent.tokenId}`
  const registryUrl = `${explorerTxBase(agent.chainId)}/token/${agent.contractAddress}?a=${agent.tokenId}`
  const verification = agent.verification
  const verdict = verdictFor(agent.chainId, verification)
  const [rechecking, setRechecking] = useState(false)
  // feedback takes the card's note slot for a few seconds
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!feedback) return
    const id = window.setTimeout(() => setFeedback(null), 8000)
    return () => window.clearTimeout(id)
  }, [feedback])

  // A single fresh probe, signed by the owner. It bypasses the twenty hour
  // reprobe window for this token, so a lister does not have to wait for the
  // next sweep to learn whether their endpoint answers.
  async function onRecheck() {
    setRechecking(true)
    setFeedback(null)
    try {
      const result = await recheckAgent(agent.chainId, agent.tokenId)
      setFeedback(
        result.skipped
          ? 'Checked within the last twenty hours, so nothing new was probed.'
          : `Fresh check recorded: ${verdictFor(agent.chainId, result.verification).label}.`,
      )
      onChanged()
    } catch (e) {
      setFeedback(hireErrorText(e))
    } finally {
      setRechecking(false)
    }
  }

  const note = feedback ?? cardNote(agent)

  return (
    <article className={cx(card('plain', 'sm'), 'flex h-[392px] min-w-0 flex-col [overflow-wrap:anywhere]')}>
      <Link to={agentHref} className="min-w-0 truncate font-serif text-[22px] leading-tight text-press-black hover:underline">
        {agent.name}
      </Link>
      <TextSlot lines={1} className="mt-1 text-[12px]">
        {categoryLabel(agent.category)} · agent #{agent.tokenId}
        {!agent.isActive ? ' · inactive' : ''}
      </TextSlot>
      <p className="mt-3 flex items-center gap-2 text-[14px] font-medium text-press-black" title={verdict.explain}>
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[verdict.tone]}`} />
        <span className="truncate">{verdict.label}</span>
        {verification ? (
          <span className="shrink-0 font-normal text-newsprint-gray">· checked {timeAgo(verification.checkedAt)}</span>
        ) : null}
      </p>
      <TextSlot lines={2} className="mt-1">
        <span title={note}>{note}</span>
      </TextSlot>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div className="min-w-0">
          <dt className={LABEL}>Buyer hires</dt>
          <dd className="mt-0.5 truncate text-press-black">{receivedLabel(received, source)}</dd>
        </div>
        <div className="min-w-0">
          <dt className={LABEL}>Earned</dt>
          <dd className="mt-0.5 truncate text-press-black">{earned}</dd>
        </div>
      </dl>

      {/* the actions in an even two-column grid pinned to the bottom, so they line up across a row */}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <Action to={agentHref} className="w-full">
          Open agent
        </Action>
        <Action href={registryUrl} className="w-full">
          Registry
        </Action>
        {verification?.status !== 'delivered' ? (
          <Action onClick={() => void onRecheck()} disabled={rechecking} className="w-full">
            {rechecking ? 'Probing...' : 'Re-check now'}
          </Action>
        ) : null}
      </div>
    </article>
  )
}

function HiresPanel({
  hires,
  source,
  error,
  chainId,
}: {
  hires: PayeeHire[] | null
  source: HiresSource
  error: string | null
  chainId: number | null
}) {
  const network = chainId ? chainLabel(chainId) : null
  const customers = (hires ?? []).filter(isCustomer)
  const others = (hires ?? []).filter((h) => !isCustomer(h))
  // one block per agent, busiest first, so a lister reads which agent earns
  const byAgent = new Map<string, PayeeHire[]>()
  for (const h of customers) {
    const key = `${h.chainId}:${h.tokenId}`
    byAgent.set(key, [...(byAgent.get(key) ?? []), h])
  }
  const agentGroups = [...byAgent.values()].sort((a, b) => b.length - a.length)
  return (
    <div className="mt-16">
      <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">Who hired your agents</h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Payments to this wallet{network ? ` on ${network}` : ''}. Our checks and your own test hires
        are kept apart from buyers.
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-[13px] text-press-black">
          {error}
        </p>
      )}

      {source === 'memory' && (
        <p className="mt-6 rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 text-[13px] leading-relaxed text-newsprint-gray">
          This server keeps receipts in memory only, so the list below may be incomplete.
        </p>
      )}

      {hires && customers.length === 0 && (
        <p className="mt-6 text-[15px] text-newsprint-gray">
          {source === 'memory'
            ? 'Nothing recorded on this server, which is not proof that nobody hired you.'
            : 'No buyer has hired your agents yet. Their payments appear here.'}
        </p>
      )}

      <div className="mt-6 space-y-6">
        {agentGroups.map((list) => {
          const first = list[0]
          return (
            <section key={`${first.chainId}:${first.tokenId}`} className={card('plain', 'none')}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b hairline border-slate-verdant/25 px-5 py-4">
                <Link
                  to={`/agents/${first.chainId}/${first.tokenId}`}
                  className="font-serif text-[22px] leading-tight text-press-black hover:underline"
                >
                  {first.agentName}
                </Link>
                <p className="text-[13px] text-newsprint-gray">
                  {list.length} {list.length === 1 ? 'hire' : 'hires'} · earned{' '}
                  <span className="text-press-black">{earnedLabel(list)}</span>
                </p>
              </div>
              <ul className="divide-y hairline divide-slate-verdant/20">
                {list.map((h) => (
                  <HireLine key={h.paymentId} hire={h} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {others.length > 0 && (
        <details className="group mt-8 metal rounded-[14px] border hairline border-slate-verdant/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="text-[14px] text-press-black">
              Checks and test hires <span className="text-newsprint-gray">· {others.length}</span>
            </span>
            <span aria-hidden="true" className="text-newsprint-gray transition group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="divide-y hairline divide-slate-verdant/20 border-t hairline border-slate-verdant/25">
            {others.map((h) => (
              <HireLine key={h.paymentId} hire={h} showAgent />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function HireLine({ hire, showAgent }: { hire: PayeeHire; showAgent?: boolean }) {
  // a sandbox hash is derived from the payment id, so only a real relayed
  // settlement links to a block explorer
  const canLinkTx = hire.mode === 'prod' && Boolean(hire.txHash)
  const who =
    hire.payer === 'check'
      ? 'Agent Souk check'
      : hire.payer === 'self'
        ? 'Your own test'
        : hire.payer === 'team'
          ? 'Agent Souk team'
          : null
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3 text-[13px]">
      <span className="text-newsprint-gray">
        {showAgent ? <span className="text-press-black">{hire.agentName} · </span> : null}
        {who ? <span className="text-press-black">{who}</span> : <span className="font-mono text-press-black">{shortAddress(hire.client)}</span>}
        {' paid '}
        <span className="text-press-black">
          {formatHireAmount(hire)} {hire.symbol}
        </span>
        {' · '}
        {timeAgo(hire.createdAt)}
        {hire.mode === 'sandbox' ? ' · test settlement' : ''}
      </span>
      <span className="flex items-center gap-4">
        {hire.active && hire.payer !== 'check' ? <span className="text-press-black">Session live</span> : null}
        {canLinkTx && hire.txHash ? (
          <a
            href={`${explorerTxBase(hire.chainId)}/tx/${hire.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-newsprint-gray underline decoration-newsprint-gray/40 underline-offset-4 hover:text-press-black"
          >
            Transaction ↗
          </a>
        ) : null}
      </span>
    </li>
  )
}
