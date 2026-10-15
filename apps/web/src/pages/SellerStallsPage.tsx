import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  activateBoost,
  getAgentsByOwner,
  getBoostStatus,
  getHiresByPayee,
  getJobs8183Jobs,
  recheckAgent,
  setListingState,
  type Jobs8183Row,
  type OwnedAgent,
  type OwnedAgentsResult,
  type PayeeHire,
} from '../lib/api'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { jobStatusName } from '../lib/jobs8183'
import { connectWallet, getActiveAccount, getProvider } from '../lib/wallet'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import {
  AgentAvatar,
  Btn,
  Dot,
  Pill,
  Rule,
  Stack,
  Row,
  Txt,
  type DotTone,
  type PillVariant,
} from '../components/souk'

type HiresSource = 'postgres' | 'memory' | null

const DAY = 86_400_000
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
    .join(' · ')
}

// a memory-mode store only knows what this instance recorded, so a total from it is a
// floor rather than the truth; a durable zero is a real zero
function receivedLabel(received: number, source: HiresSource): string {
  if (source === 'postgres') return String(received)
  if (source === 'memory') return received > 0 ? `${received} seen here` : 'Unavailable here'
  return 'Unavailable'
}

// a stall is a listing that cannot prove it answers: the last check failed or never
// ran, or the listing is already off the market. A delivered listing is not a stall.
function isStall(agent: OwnedAgent): boolean {
  if (agent.delisted) return true
  if (agent.failingSince) return true
  if (agent.verification === null || agent.verification === undefined) return true
  return agent.verification.status !== 'delivered'
}

function stallPill(agent: OwnedAgent): { text: string; variant: PillVariant } {
  const off = agent.delisted
  if (off?.reason === 'owner delist') return { text: 'Unlisted', variant: 'off' }
  if (off) return { text: 'Off market', variant: 'warn' }
  if (agent.verification?.status === 'gated') return { text: 'Restricted', variant: 'warn' }
  return { text: 'Quiet', variant: 'off' }
}

// the one quiet-state note the verdict row carries, most specific first
function stallNote(agent: OwnedAgent): string {
  const off = agent.delisted
  if (off) {
    return off.at ? `off the market ${timeAgo(off.at)}` : 'off the market'
  }
  if (agent.failingSince) {
    // the sweep runs daily, so a listing can sit past day 7 for a few hours before it is removed
    const days = Math.min(7, Math.max(0, Math.floor((Date.now() - Date.parse(agent.failingSince)) / DAY)))
    return `quiet for ${days} of 7 days`
  }
  if (agent.verification) return `checked ${timeAgo(agent.verification.checkedAt)}`
  return 'never checked'
}

// the wallet's recorded escrow jobs against one listing, folded into status names
function escrowNote(rows: Jobs8183Row[]): string {
  if (rows.length === 0) return 'none on record'
  const byStatus = new Map<string, number>()
  for (const r of rows) {
    const name = r.status === null ? 'status unread' : jobStatusName(r.status).toLowerCase()
    byStatus.set(name, (byStatus.get(name) ?? 0) + 1)
  }
  return [...byStatus.entries()].map(([name, count]) => `${count} ${name}`).join(' · ')
}

function hiredWithin(days: number, list: PayeeHire[]): PayeeHire[] {
  const floor = Date.now() - days * DAY
  return list.filter((h) => Date.parse(h.createdAt) >= floor)
}

function jobsWithin(days: number, list: Jobs8183Row[]): Jobs8183Row[] {
  const floor = Date.now() - days * DAY
  return list.filter((r) => Date.parse(r.updatedAt) >= floor)
}

export function SellerStallsPage() {
  const [account, setAccount] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [jobs, setJobs] = useState<Jobs8183Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)

  useEffect(() => {
    void getActiveAccount().then(setAccount)
  }, [])

  async function connect() {
    setConnecting(true)
    try {
      setAccount(await connectWallet())
    } finally {
      setConnecting(false)
    }
  }

  const load = useCallback(async () => {
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      setJobs(null)
      return
    }
    setLoading(true)
    setError(null)
    setHiresError(null)
    // the reads are independent, so one failing source never hides the listings
    const [ownedResult, hiresResult, jobsResult] = await Promise.allSettled([
      getAgentsByOwner(account),
      getHiresByPayee(account),
      getJobs8183Jobs(account),
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
    // escrow rows are a reading, not a commitment: a failed read leaves the column honest
    setJobs(jobsResult.status === 'fulfilled' ? jobsResult.value : null)
    setLoading(false)
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  const agents = owned?.agents ?? []
  const stalls = agents.filter(isStall)
  const byToken = new Map<string, PayeeHire[]>()
  for (const h of hires ?? []) {
    const key = `${h.chainId}:${h.tokenId}`
    byToken.set(key, [...(byToken.get(key) ?? []), h])
  }
  const jobsByToken = new Map<string, Jobs8183Row[]>()
  for (const r of jobs ?? []) {
    const key = `${r.chainId}:${r.tokenId}`
    jobsByToken.set(key, [...(jobsByToken.get(key) ?? []), r])
  }
  const chainId = owned?.chainId ?? agents[0]?.chainId ?? null

  const kicker = account
    ? [
        'seller / stalls',
        `${stalls.length} of ${agents.length} listings`,
        chainId !== null ? chainLabel(chainId) : null,
        'board b',
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : 'seller / stalls'

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      <Stack gap={10} className="max-w-[1180px]">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} display weight="bold" tone="ink">
            Your stalls.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          One card per listing that cannot prove it answers: the same parts in the same
          order, so the row reads evenly and the actions line up along the bottom.
        </Txt>
      </Stack>

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you listed with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            A stall belongs to the listing the registry records as yours.
          </Txt>
          <Btn kind="primary" onClick={connect} disabled={connecting} className="mt-2 w-fit">
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </Btn>
        </Stack>
      )}

      {account && (
        <>
          <Row justify="between" align="center" gap={16} className="mt-8 flex-wrap">
            <Txt size={11} lead={16} mono tone="labels">
              stalls for <Txt tone="slate">{shortAddress(account)}</Txt>
            </Txt>
            <Btn kind="off" onClick={() => void load()} disabled={loading}>
              {loading ? 'Reading...' : 'Refresh'}
            </Btn>
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

          {owned && !loading && stalls.length === 0 && (
            <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
              <Txt size={15} lead={22} tone="ink">
                No stalls on the board.
              </Txt>
              <Txt size={13} lead={20} tone="muted">
                {agents.length > 0
                  ? 'Every listing this wallet owns answered its last check. A card appears here when a check starts failing or a listing is taken off the market.'
                  : 'This wallet owns no listed agents here yet.'}
              </Txt>
            </Stack>
          )}

          {stalls.length > 0 && (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              {stalls.map((agent) => (
                <StallCard
                  key={`${agent.chainId}:${agent.tokenId}`}
                  account={account}
                  agent={agent}
                  tokenHires={byToken.get(`${agent.chainId}:${agent.tokenId}`) ?? []}
                  hiresSource={hiresSource}
                  tokenJobs={jobsByToken.get(`${agent.chainId}:${agent.tokenId}`) ?? []}
                  jobsRead={jobs !== null}
                  onChanged={() => void load()}
                />
              ))}
              <AddStallSlot />
            </div>
          )}

          {stalls.length === 0 && (
            <div className="mt-6 max-w-[680px]">
              <Rule />
              <Txt size={12} lead={18} tone="muted" className="mt-2 block">
                Re-check is free and runs the probe. Boost is a settled payment that moves a
                listing up the shelf for the window it was bought for.
              </Txt>
            </div>
          )}

          {stalls.length > 0 && (
            <Stack gap={8} className="mt-8">
              <Rule />
              <Txt size={12} lead={18} tone="muted">
                Re-check is free and runs the probe. Boost is a settled payment that moves a
                listing up the shelf for the window it was bought for.
                {hiresError ? ` Hires were not readable this pass: ${hiresError}` : ''}
              </Txt>
            </Stack>
          )}
        </>
      )}
    </div>
  )
}

// the design's three stat boxes: a zero is steel, never the green the figures get
function StatBox({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'data' | 'steel'
}) {
  return (
    <Stack bg="surface2" pad={[10, 12, 10, 12]} gap={2} radius={8} className="min-w-0">
      <Txt size={16} lead={22} mono tone={tone}>
        {value}
      </Txt>
      <Txt size={10} lead={14} weight="bold" upper tone="muted">
        {label}
      </Txt>
    </Stack>
  )
}

// the card's own action, in the design's small hairline button: same shape profile uses
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
        <Txt size={12} lead={18} weight="semibold" tone={primary ? 'canvas' : 'slate'} className="truncate">
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
      <Txt size={12} lead={18} weight="semibold" tone={primary ? 'canvas' : 'slate'} className="truncate">
        {children}
      </Txt>
    </button>
  )
}

function StallCard({
  account,
  agent,
  tokenHires,
  hiresSource,
  tokenJobs,
  jobsRead,
  onChanged,
}: {
  account: string
  agent: OwnedAgent
  tokenHires: PayeeHire[]
  hiresSource: HiresSource
  tokenJobs: Jobs8183Row[]
  jobsRead: boolean
  onChanged: () => void
}) {
  const agentHref = `/agents/${agent.chainId}/${agent.tokenId}`
  const registryUrl = `${explorerTxBase(agent.chainId)}/token/${agent.contractAddress}?a=${agent.tokenId}`
  const verdict = verdictFor(agent.chainId, agent.verification)
  const offMarket = agent.delisted ?? null
  const pill = stallPill(agent)
  const note = stallNote(agent)
  const recentHires = hiredWithin(14, tokenHires).filter(isCustomer)
  const recentJobs = jobsWithin(30, tokenJobs).filter((r) => r.chainId === agent.chainId)

  const [rechecking, setRechecking] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [boosting, setBoosting] = useState(false)
  // feedback takes the verdict row's note slot for a few seconds
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!feedback) return
    const id = window.setTimeout(() => setFeedback(null), 8000)
    return () => window.clearTimeout(id)
  }, [feedback])

  // one fresh probe with the owner's signature, so a wait for the next sweep is not required
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

  // a listing off the market goes back on with the same signed message it left with
  async function onSwitch() {
    setSwitching(true)
    setFeedback(null)
    try {
      if (offMarket) {
        await setListingState(agent.chainId, agent.tokenId, 'relist')
      } else {
        await setListingState(agent.chainId, agent.tokenId, 'delist')
      }
      onChanged()
    } catch (e) {
      setFeedback(hireErrorText(e))
    } finally {
      setSwitching(false)
    }
  }

  // owner-only: eligibility first, then a signature over the boost terms and a settled
  // x402 paymentId the boost route can verify, exactly as the agent page asks for it
  async function onBoost() {
    setBoosting(true)
    setFeedback(null)
    try {
      const status = await getBoostStatus(agent.chainId, agent.tokenId)
      if (status.boost) {
        setFeedback(`Boost active until ${new Date(status.boost.expiresAt).toLocaleDateString()}.`)
        return
      }
      if (!status.eligible) {
        setFeedback(
          status.missing.length
            ? `Boost locked until the verifier checklist passes: ${status.missing.join(', ')}.`
            : 'Boost locked until the verifier checklist passes.',
        )
        return
      }
      const days = 7
      const nonce = `0x${Date.now().toString(16)}`
      const messageToSign = [
        'Agent Souk boost',
        `chainId: ${agent.chainId}`,
        `tokenId: ${agent.tokenId}`,
        `owner: ${account.toLowerCase()}`,
        `days: ${days}`,
        `nonce: ${nonce}`,
      ].join('\n')
      const provider = await getProvider()
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [messageToSign, account],
      })) as string
      const paymentId = window.prompt(
        'Paste a settled x402 paymentId from YOUR owner wallet (hire once as owner, then paste that payment id). 7 days.',
      )
      if (!paymentId?.trim()) return
      const result = await activateBoost({
        chainId: agent.chainId,
        tokenId: agent.tokenId,
        days,
        paymentId: paymentId.trim(),
        owner: account,
        signature,
        nonce,
      })
      setFeedback(`Boosted until ${new Date(result.expiresAt).toLocaleString()}.`)
      onChanged()
    } catch (e) {
      setFeedback(hireErrorText(e))
    } finally {
      setBoosting(false)
    }
  }

  const hiresValue = receivedLabel(recentHires.length, hiresSource)
  const earnedValue = earnedLabel(tokenHires)
  const jobsValue = jobsRead ? escrowNote(recentJobs) : 'not read this pass'

  return (
    <Stack surface pad={[16, 16, 14, 16]} gap={12} className="min-w-0 [overflow-wrap:anywhere]">
      <Row align="center" gap={12} className="min-w-0">
        <AgentAvatar size={34} name={agent.name} />
        <Stack gap={2} className="min-w-0 flex-1">
          <Link to={agentHref} className="min-w-0 truncate">
            <Txt size={17} lead={22} weight="bold" tone="ink">
              {agent.name}
            </Txt>
          </Link>
          <Txt size={11} lead={15} mono tone="labels" className="truncate">
            {chainLabel(agent.chainId)} · #{agent.tokenId}
          </Txt>
        </Stack>
        <Row align="center" gap={8} className="shrink-0">
          <Pill variant="off">{categoryLabel(agent.category)}</Pill>
          <Pill variant={pill.variant}>{pill.text}</Pill>
        </Row>
      </Row>

      <Row justify="between" align="center" gap={8} className="min-w-0">
        <span title={offMarket ? undefined : verdict.explain} className="inline-flex min-w-0 items-center gap-2">
          <Dot tone={VERDICT_TONE[verdict.tone]} size={8} />
          <Txt size={13} lead={18} tone="slate" className="truncate">
            {verdict.label}
          </Txt>
        </span>
        <Txt size={12} lead={18} tone="muted" className="shrink-0">
          {feedback ?? note}
        </Txt>
      </Row>

      <Row gap={10} className="min-w-0" style={{ flexWrap: 'wrap' }}>
        <div className="min-w-[148px] flex-1 basis-[148px]">
          <StatBox
            label="Hires, 14d"
            value={hiresValue}
            tone={recentHires.length > 0 ? 'data' : 'steel'}
          />
        </div>
        <div className="min-w-[148px] flex-1 basis-[148px]">
          <StatBox
            label="Earned"
            value={earnedValue}
            tone={earnedValue === 'nothing yet' ? 'steel' : 'data'}
          />
        </div>
        <div className="min-w-[148px] flex-1 basis-[148px]">
          <StatBox
            label="Escrow jobs, 30d"
            value={jobsValue}
            tone={recentJobs.length > 0 ? 'data' : 'steel'}
          />
        </div>
      </Row>

      <Rule hair />
      {/* actions pinned to the bottom so they line up across the row of cards */}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
        <CardAction onClick={() => void onRecheck()} disabled={rechecking} className="w-full">
          {rechecking ? 'Probing...' : 'Re-check now'}
        </CardAction>
        <CardAction onClick={() => void onBoost()} disabled={boosting || Boolean(offMarket)} className="w-full">
          {boosting ? 'Reading...' : 'Boost'}
        </CardAction>
        {offMarket ? (
          <CardAction onClick={() => void onSwitch()} disabled={switching} className="w-full">
            {switching ? 'Relisting...' : 'Relist'}
          </CardAction>
        ) : (
          <CardAction onClick={() => void onSwitch()} disabled={switching} className="w-full">
            {switching ? 'Unlisting...' : 'Unlist'}
          </CardAction>
        )}
        <CardAction href={registryUrl} className="w-full">
          Registry
        </CardAction>
      </div>
    </Stack>
  )
}

// the standing invitation the drawing leaves in the last slot of the grid
function AddStallSlot() {
  return (
    <Stack pad={[40, 16, 40, 16]} gap={10} radius={20} hair className="items-center text-center">
      <Txt size={13} lead={16} mono className="text-souk-muted">
        Agent Souk
      </Txt>
      <Txt size={15} lead={22} weight="semibold" tone="slate">
        Another agent, another stall.
      </Txt>
      <Txt size={12} lead={18} tone="muted">
        Registration writes the listing to the contract, and the first check runs within
        the hour of it landing.
      </Txt>
      <Link
        to="/list"
        className="mt-1 inline-flex h-11 w-fit items-center justify-center rounded-[8px] border border-transparent bg-souk-data px-5 text-souk-canvas transition hover:opacity-90"
      >
        <Txt size={14} lead={20} weight="semibold" tone="canvas">
          List an agent
        </Txt>
      </Link>
    </Stack>
  )
}
