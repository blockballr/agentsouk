import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  getAgentsByOwner,
  getBoostStatus,
  getHiresByPayee,
  recheckAgent,
  setListingState,
  type OwnedAgent,
  type OwnedAgentsResult,
  type PayeeHire,
} from '../lib/api'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { checkMarks, checkSummary, countByDay, getCheckHistory, type CheckRecord } from '../lib/history'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { changeWallet, connectWallet } from '../lib/wallet-session'
import { useActiveAccount } from '../lib/use-active-account'
import {
  AgentAvatar,
  Btn,
  Dot,
  Kpi,
  Label,
  Pill,
  Row,
  Rule,
  SectionHead,
  Stack,
  Txt,
  type DotTone,
} from '../components/souk'

type HiresSource = 'postgres' | 'memory' | null

// the verdict's four tones in the design's five-state dot grammar
const VERDICT_TONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

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
  // the profile's wallet, watched so a switch inside the wallet re-reads the board
  const account = useActiveAccount()
  const [connecting, setConnecting] = useState(false)
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)
  // each listing's recent checks, for its strip; null until read, and left null if it cannot be
  const [checks, setChecks] = useState<Record<string, CheckRecord[]> | null>(null)

  const load = useCallback(async () => {
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      setChecks(null)
      return
    }
    setLoading(true)
    setError(null)
    setHiresError(null)
    // the reads are independent, so a receipts outage must not hide the listings
    const [ownedResult, hiresResult] = await Promise.allSettled([
      getAgentsByOwner(account),
      getHiresByPayee(account),
    ])
    if (ownedResult.status === 'fulfilled') {
      setOwned(ownedResult.value)
      // the history is an extra: the page stands without it, so a failed read only leaves it out
      getCheckHistory(ownedResult.value.agents.map((a) => a.tokenId))
        .then(setChecks)
        .catch(() => setChecks(null))
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

  async function onChangeWallet() {
    setConnecting(true)
    try {
      await changeWallet()
      // a dismissed picker has already dropped the old choice, so the watched
      // account shows what is connected now
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  async function onConnect() {
    setConnecting(true)
    try {
      await connectWallet()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  const agents = owned?.agents ?? []
  const offMarket = agents.filter((a) => a.delisted).length
  const answering = agents.filter((a) => !a.delisted && a.verification?.status === 'delivered').length
  // only buyers count as hires received; our checks and self-tests would inflate it
  const customerHires = (hires ?? []).filter(isCustomer)
  const byToken = new Map<string, PayeeHire[]>()
  for (const h of customerHires) {
    const key = `${h.chainId}:${h.tokenId}`
    byToken.set(key, [...(byToken.get(key) ?? []), h])
  }
  const settledChain = hires?.[0]?.chainId ?? owned?.chainId ?? null

  const onMarket = agents.length - offMarket
  const kicker = account
    ? [
        'profile',
        shortAddress(account),
        owned
          ? `${onMarket} on the market${offMarket > 0 ? `, ${offMarket} off` : ''}`
          : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : 'profile'

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      <Stack gap={10} className="max-w-[1180px]">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Your listings.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          What you have listed, whether it answers our checks, and who has hired it.
        </Txt>
      </Stack>

      <Row justify="between" align="center" gap={16} className="mt-8 flex-wrap">
        <Txt size={11} lead={16} mono tone="labels">
          {account ? (
            <>showing listings for <Txt tone="slate">{shortAddress(account)}</Txt></>
          ) : (
            'no wallet connected'
          )}
        </Txt>
        {account ? (
          <Btn kind="off" onClick={() => void load()} disabled={loading}>
            {loading ? 'Reading...' : 'Refresh'}
          </Btn>
        ) : (
          <Btn kind="primary" onClick={onConnect} disabled={connecting}>
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </Btn>
        )}
      </Row>

          {error && (
            <div role="alert" className="mt-6">
              <Stack pad={[14, 16, 14, 16]} radius={14} hair>
                <Txt size={13} lead={20} tone="peach">
                  {error}
                </Txt>
              </Stack>
            </div>
          )}

          {owned && agents.length > 0 && (
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  label: 'Buyer hires',
                  value: hires ? receivedLabel(customerHires.length, hiresSource) : 'Unavailable',
                  note: 'Buyers only, not our checks',
                },
                {
                  label: 'Earned',
                  value: hires ? earnedLabel(customerHires) : 'Unavailable',
                  note: 'Settled payments from buyers',
                },
                {
                  label: 'Agents answering',
                  value: `${answering} of ${onMarket}`,
                  note: 'On their last check',
                },
              ].map((k) => (
                <div key={k.label} className="min-w-0">
                  <Kpi value={k.value} label={k.label} />
                  <Txt size={11} lead={16} tone="muted" className="mt-1.5 block truncate">
                    {k.note}
                  </Txt>
                </div>
              ))}
            </div>
          )}

          <div className="mt-10">
            <SectionHead title="Your listings" note={owned ? `${agents.length} owned on this chain` : undefined} />
            <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {!account && (
                <Stack surface pad={[28, 28, 28, 28]} gap={8} className="md:col-span-2 lg:col-span-3">
                  <Txt size={15} lead={22} tone="slate">
                    Connect the wallet you listed with.
                  </Txt>
                  <Txt size={13} lead={20} tone="muted">
                    A listing belongs to the wallet the registry records as its owner.
                  </Txt>
                  <Btn kind="primary" onClick={onConnect} disabled={connecting} className="mt-2 self-start">
                    {connecting ? 'Connecting...' : 'Connect wallet'}
                  </Btn>
                </Stack>
              )}

              {owned && agents.length === 0 && (
                <Stack surface pad={[28, 28, 28, 28]} gap={8} className="md:col-span-2 lg:col-span-3">
                  <Txt size={15} lead={22} tone="slate">
                    This wallet owns no listed agents on this chain yet.
                  </Txt>
                  <Txt size={13} lead={20} tone="muted">
                    Just registered? The catalogue reads the chain again within a minute, and a listing shows once it has an endpoint we can call.
                  </Txt>
                  <Btn kind="primary" onClick={() => void onChangeWallet()} disabled={connecting} className="mt-2 self-start">
                    {connecting ? 'Switching...' : 'Switch wallet'}
                  </Btn>
                </Stack>
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
          </div>

          {agents.length > 0 && (
            <AgentHistory agents={agents} hires={customerHires} checks={checks} />
          )}

          <HiresPanel
            hires={hires}
            source={hiresSource}
            error={hiresError}
            chainId={settledChain}
          />

          <Row
            justify="between"
            align="center"
            gap={12}
            pad={[14, 16, 14, 16]}
            radius={8}
            bg="indigo"
            hair
            className="mt-14 flex-wrap"
          >
            <Row align="center" gap={10}>
              <Dot tone="sky" size={8} />
              <Stack gap={2}>
                <Txt size={13} lead={20} weight="bold" tone="ink">
                  List another agent
                </Txt>
                <Txt size={12} lead={18} tone="slate">
                  One transaction from your wallet registers it, with you as the owner.
                </Txt>
              </Stack>
            </Row>
            <Link
              to="/list"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-[8px] border border-souk-hair bg-souk-surface1 px-5 transition hover:border-souk-hair"
            >
              <Txt size={14} lead={20} weight="semibold" tone="slate">
                Open the listing wizard
              </Txt>
            </Link>
          </Row>
    </div>
  )
}

type BoostState = Awaited<ReturnType<typeof getBoostStatus>> | 'loading' | null

function boostLabel(state: BoostState): string {
  if (state === 'loading') return 'Reading...'
  if (!state) return 'Unavailable'
  if (state.boost) {
    const until = new Date(state.boost.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return `Active until ${until}`
  }
  if (state.eligible) return 'Not boosted, eligible'
  return `Locked until it passes: ${state.missing.join(', ')}`
}

// the one note a card has room for, most urgent first; every note fits the two-line slot
function cardNote(agent: OwnedAgent): string {
  const off = agent.delisted
  if (off?.reason === 'owner delist') {
    return `You took it off the market${off.at ? ` ${timeAgo(off.at)}` : ''}. Relist to put it back on the marketplace.`
  }
  if (off?.reason === 'auto-stale') {
    return 'Removed after 7 days without answering. Re-check before relisting.'
  }
  if (off) return 'Off the market.'
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
  const offMarket = agent.delisted ?? null
  const [rechecking, setRechecking] = useState(false)
  const [switching, setSwitching] = useState(false)
  // feedback takes the card's note slot for a few seconds
  const [feedback, setFeedback] = useState<string | null>(null)
  const [boost, setBoost] = useState<BoostState>('loading')

  useEffect(() => {
    if (!feedback) return
    const id = window.setTimeout(() => setFeedback(null), 8000)
    return () => window.clearTimeout(id)
  }, [feedback])

  useEffect(() => {
    if (offMarket) return
    let live = true
    getBoostStatus(agent.chainId, agent.tokenId)
      .then((s) => live && setBoost(s))
      .catch(() => live && setBoost(null))
    return () => {
      live = false
    }
  }, [agent.chainId, agent.tokenId, offMarket])

  // A single fresh probe, signed by the owner. It bypasses the twenty hour
  // reprobe window for this token, so a lister does not have to wait for the
  // next sweep to learn whether their endpoint answers.
  async function onRecheck() {
    setRechecking(true)
    setFeedback(null)
    try {
      const result = await recheckAgent(agent.chainId, agent.tokenId)
      // an off-market card keeps its status line, so the result is named here
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

  // a card that is off the market can be put back; taking one off is not offered here
  async function onRelist() {
    setSwitching(true)
    setFeedback(null)
    try {
      await setListingState(agent.chainId, agent.tokenId, 'relist')
      onChanged()
    } catch (e) {
      setFeedback(hireErrorText(e))
    } finally {
      setSwitching(false)
    }
  }

  const note = feedback ?? cardNote(agent)
  const boostText = offMarket ? 'Not shown while off the market' : boostLabel(boost)

  return (
    <Stack surface pad={[20, 22, 20, 22]} gap={10} className="h-[392px] min-w-0 [overflow-wrap:anywhere]">
      <Row align="center" gap={12}>
        <AgentAvatar size={34} name={agent.name} chainId={agent.chainId} tokenId={agent.tokenId} />
        <Stack gap={2} className="min-w-0 flex-1">
          <Link to={agentHref} className="min-w-0 truncate">
            <Txt size={16} lead={24} weight="bold" tone="ink">
              {agent.name}
            </Txt>
          </Link>
          <Txt size={11} lead={16} mono tone="labels" className="truncate">
            {categoryLabel(agent.category)} · #{agent.tokenId}
            {!agent.isActive ? ' · inactive' : ''}
          </Txt>
        </Stack>
        {offMarket ? <Pill variant="warn">Off market</Pill> : null}
      </Row>

      <Row justify="between" align="center" gap={8} className="min-w-0">
        <span title={offMarket ? undefined : verdict.explain} className="inline-flex min-w-0 items-center gap-2">
          <Dot tone={VERDICT_TONE[offMarket ? 'bad' : verdict.tone]} size={9} />
          <Txt size={14} lead={18} tone="slate" className="truncate">
            {offMarket ? 'Off the market' : verdict.label}
          </Txt>
        </span>
        {!offMarket && verification ? (
          <Txt size={11} lead={16} mono tone="muted" className="shrink-0">
            checked {timeAgo(verification.checkedAt)}
          </Txt>
        ) : null}
      </Row>

      <span title={note} className="inline-block">
        <Txt size={12} lead={18} tone="steel" className="line-clamp-2">
          {note}
        </Txt>
      </span>

      <Rule />

      <Stack gap={6}>
        <Row justify="between" align="start" gap={12}>
          <Txt size={12} lead={18} tone="muted">
            Buyer hires
          </Txt>
          <Txt size={12} lead={18} mono tone="slate" className="min-w-0 text-right">
            {receivedLabel(received, source)}
          </Txt>
        </Row>
        <Row justify="between" align="start" gap={12}>
          <Txt size={12} lead={18} tone="muted">
            Earned
          </Txt>
          <Txt size={12} lead={18} mono tone="slate" className="min-w-0 text-right">
            {earned}
          </Txt>
        </Row>
        <Row justify="between" align="start" gap={12}>
          <Txt size={12} lead={18} tone="muted">
            Boost
          </Txt>
          <span title={boostText} className="min-w-0 text-right">
            <Txt size={12} lead={18} mono tone="slate" className="line-clamp-2">
              {boostText}
            </Txt>
          </span>
        </Row>
      </Stack>

      {/* the actions in an even two-column grid pinned to the bottom, so they line up across a row */}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
        <CardAction to={agentHref} className="w-full">
          Open agent
        </CardAction>
        <CardAction href={registryUrl} className="w-full">
          Registry
        </CardAction>
        {verification?.status !== 'delivered' ? (
          <CardAction onClick={() => void onRecheck()} disabled={rechecking} className="w-full">
            {rechecking ? 'Probing...' : 'Re-check now'}
          </CardAction>
        ) : null}
        {offMarket ? (
          <CardAction variant="primary" onClick={() => void onRelist()} disabled={switching} className="w-full">
            {switching ? 'Relisting...' : 'Relist'}
          </CardAction>
        ) : null}
      </div>
    </Stack>
  )
}

// the card's own action, in the design's small hairline button: one primary per card,
// the rest resting on the rim, with the same props the old action slot carried
function CardAction({
  variant,
  to,
  href,
  onClick,
  disabled,
  className,
  children,
}: {
  variant?: 'primary'
  to?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const primary = variant === 'primary'
  const cls = [
    'inline-flex h-9 w-full items-center justify-center rounded-[8px] border px-3 text-left transition',
    primary ? 'border-transparent bg-souk-data text-souk-canvas' : 'border-souk-hair bg-souk-surface1 text-souk-slate',
    disabled ? 'cursor-not-allowed opacity-40' : primary ? 'hover:opacity-90' : 'hover:border-souk-hair',
    className ?? '',
  ].join(' ')
  if (to) {
    return (
      <Link to={to} className={cls}>
        <Txt size={12} lead={18} weight="semibold" tone={variant === 'primary' ? 'canvas' : 'slate'} className="truncate">
          {children}
        </Txt>
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        <Txt size={12} lead={18} weight="semibold" tone="slate" className="truncate">
          {children}
        </Txt>
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      <Txt size={12} lead={18} weight="semibold" tone={variant === 'primary' ? 'canvas' : 'slate'} className="truncate">
        {children}
      </Txt>
    </button>
  )
}

// how each listing has done lately: buyer hires by day and its run of checks. Both start
// from the day the record began, so a new listing shows an honest empty strip
function AgentHistory({
  agents,
  hires,
  checks,
}: {
  agents: OwnedAgent[]
  hires: PayeeHire[]
  checks: Record<string, CheckRecord[]> | null
}) {
  return (
    <div className="mt-12">
      <SectionHead title="How each agent is doing" note="LAST TWO WEEKS" />
      <Txt size={13} lead={20} tone="muted" className="mt-3 block max-w-[900px]">
        Buyer hires by day over the last two weeks, and each agent&apos;s latest checks. The oldest is on the left.
      </Txt>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {agents.map((agent) => {
          const own = hires.filter((h) => h.chainId === agent.chainId && h.tokenId === agent.tokenId)
          const days = countByDay(own.map((h) => h.createdAt))
          const total = days.reduce((sum, d) => sum + d.count, 0)
          const record = checks?.[agent.tokenId] ?? []
          return (
            <Stack key={`${agent.chainId}:${agent.tokenId}`} surface pad={[16, 16, 16, 16]} gap={10} className="min-w-0">
              <Link to={`/agents/${agent.chainId}/${agent.tokenId}`} className="min-w-0 truncate">
                <Txt size={15} lead={20} weight="bold" tone="ink">
                  {agent.name}
                </Txt>
              </Link>
              <Label>Buyer hires, last 14 days</Label>
              <HistoryBar days={days} label={`${total} buyer ${total === 1 ? 'hire' : 'hires'} in the last 14 days`} />
              <Txt size={11} lead={16} mono tone="labels">
                {total === 0 ? 'none in the last two weeks' : `${total} in the last two weeks`}
              </Txt>
              <Rule />
              <Label>Checks</Label>
              {record.length > 0 ? <CheckMarks marks={checkMarks(record)} label={checkSummary(record)} /> : null}
              <Txt size={12} lead={18} tone="steel">
                {checks === null
                  ? 'The record could not be read just now'
                  : record.length === 0
                    ? 'No checks recorded yet'
                    : checkSummary(record)}
              </Txt>
            </Stack>
          )
        })}
      </div>
    </div>
  )
}

// the day strip, redrawn in the register's tones: a day with nothing keeps a faint tick,
// so the days can still be counted
function HistoryBar({ days, label }: { days: { day: string; count: number }[]; label: string }) {
  const top = Math.max(1, ...days.map((d) => d.count))
  const step = 10
  const height = 32
  return (
    <svg
      viewBox={`0 0 ${days.length * step} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-8 w-full"
    >
      {days.map((d, i) => {
        const h = d.count === 0 ? 1 : Math.max(3, Math.round((d.count / top) * (height - 2)))
        return (
          <rect
            key={d.day}
            x={i * step + 1.5}
            y={height - h}
            width={step - 3}
            height={h}
            className={d.count === 0 ? 'fill-souk-surface2' : 'fill-souk-data'}
          >
            <title>{`${d.day}: ${d.count}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

// the check record as marks: filled when it answered, held when gated, rim only when missed
function CheckMarks({ marks, label }: { marks: { state: 'answered' | 'gated' | 'missed'; title: string }[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex flex-wrap gap-[3px]">
      {marks.map((m, i) => (
        <span
          key={i}
          title={m.title}
          className={[
            'h-3 w-3 rounded-[3px]',
            m.state === 'answered' && 'bg-souk-data',
            m.state === 'gated' && 'bg-souk-data/50',
            m.state === 'missed' && 'border border-souk-steel',
          ].filter(Boolean).join(' ')}
        />
      ))}
    </div>
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
    <div className="mt-12">
      <SectionHead title="Who hired your agents" note={network ?? undefined} />
      <Txt size={13} lead={20} tone="muted" className="mt-3 block max-w-[900px]">
        Payments to this wallet{network ? ` on ${network}` : ''}. Our checks and your own test hires
        are kept apart from buyers.
      </Txt>

      {error && (
        <div role="alert" className="mt-6">
          <Stack pad={[14, 16, 14, 16]} radius={14} hair>
            <Txt size={13} lead={20} tone="peach">
              {error}
            </Txt>
          </Stack>
        </div>
      )}

      {source === 'memory' && (
        <Stack pad={[14, 16, 14, 16]} radius={14} hair className="mt-6">
          <Txt size={13} lead={20} tone="slate">
            This server keeps receipts in memory only, so the list below may be incomplete.
          </Txt>
        </Stack>
      )}

      {hires && customers.length === 0 && (
        <Txt size={13} lead={20} tone="muted" className="mt-6 block">
          {source === 'memory'
            ? 'Nothing recorded on this server, which is not proof that nobody hired you.'
            : 'No buyer has hired your agents yet. Their payments appear here.'}
        </Txt>
      )}

      {agentGroups.length > 0 && (
        <Stack gap={20} className="mt-6">
          {agentGroups.map((list) => {
            const first = list[0]
            return (
              <Stack key={`${first.chainId}:${first.tokenId}`} surface pad={[16, 20, 16, 20]} gap={4} className="min-w-0">
                <Row justify="between" align="center" gap={24} className="flex-wrap pb-2">
                  <Link to={`/agents/${first.chainId}/${first.tokenId}`} className="min-w-0 truncate">
                    <Txt size={15} lead={20} weight="bold" tone="ink">
                      {first.agentName}
                    </Txt>
                  </Link>
                  <Txt size={12} lead={18} tone="labels">
                    {list.length} {list.length === 1 ? 'hire' : 'hires'} · earned{' '}
                    <Txt size={12} lead={18} mono tone="data">
                      {earnedLabel(list)}
                    </Txt>
                  </Txt>
                </Row>
                <ul className="m-0 list-none p-0">
                  {list.map((h) => (
                    <HireLine key={h.paymentId} hire={h} />
                  ))}
                </ul>
              </Stack>
            )
          })}
        </Stack>
      )}

      {others.length > 0 && (
        <details className="group mt-8">
          <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-4 rounded-[8px] border border-souk-hair bg-souk-surface1 px-4 py-3 transition hover:border-souk-hair [&::-webkit-details-marker]:hidden">
            <Txt size={11} lead={16} mono weight="semibold" upper tone="steel">
              Checks and test hires · {others.length}
            </Txt>
            <span aria-hidden="true" className="text-souk-steel transition group-open:rotate-180">
              ▾
            </span>
          </summary>
          <Stack surface pad={[8, 20, 8, 20]} className="mt-2">
            <ul className="m-0 list-none p-0">
              {others.map((h) => (
                <HireLine key={h.paymentId} hire={h} showAgent />
              ))}
            </ul>
          </Stack>
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
    <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-souk-edge py-3 text-[13px] last:border-b-0">
      <span className="min-w-0 leading-[20px] text-souk-slate">
        {showAgent ? <span className="text-souk-ink">{hire.agentName} · </span> : null}
        {who ? <span className="text-souk-ink">{who}</span> : <span className="font-mono text-souk-slate">{shortAddress(hire.client)}</span>}
        {' paid '}
        <span className="font-mono text-souk-ink">
          {formatHireAmount(hire)} {hire.symbol}
        </span>
        {' · '}
        {timeAgo(hire.createdAt)}
        {hire.mode === 'sandbox' ? ' · test settlement' : ''}
      </span>
      <span className="flex items-baseline gap-4">
        {hire.active && hire.payer !== 'check' ? <span className="text-[12px] leading-[18px] text-souk-data">Session live</span> : null}
        {canLinkTx && hire.txHash ? (
          <a
            href={`${explorerTxBase(hire.chainId)}/tx/${hire.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] leading-[16px] text-souk-sky transition hover:text-souk-ink"
          >
            Transaction ↗
          </a>
        ) : null}
      </span>
    </li>
  )
}
