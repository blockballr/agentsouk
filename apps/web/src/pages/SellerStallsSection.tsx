import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  activateBoost,
  getBoostStatus,
  recheckAgent,
  setListingState,
  type Jobs8183Row,
  type OwnedAgent,
  type PayeeHire,
} from '../lib/api'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { jobStatusName } from '../lib/jobs8183'
import { getProvider } from '../lib/wallet'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { type HiresSource, useSellerData } from '../lib/seller-data'
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

export function SellerStallsSection() {
  // the agents read the same listings and receipts the console loaded once
  const {
    account,
    owned,
    hires,
    hiresSource,
    jobs,
    loading,
    ownedError: error,
    hiresError,
    reload,
  } = useSellerData()

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
        'seller / agents',
        `${stalls.length} of ${agents.length} listings`,
        chainId !== null ? chainLabel(chainId) : null,
        'board b',
      ]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : 'seller / agents'

  return (
    <section id="agents" className="mt-16 scroll-mt-24 border-t border-souk-hair pt-12 text-souk-ink">
      <Stack gap={10} className="w-full">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h2 className="m-0">
          <Txt size={28} lead={36} display weight="bold" tone="ink">
            Your agents.
          </Txt>
        </h2>
      </Stack>

      {account && (
        <>
          <Row justify="between" align="center" gap={16} className="mt-8 flex-wrap">
            <Txt size={11} lead={16} mono tone="labels">
              agents for <Txt tone="slate">{shortAddress(account)}</Txt>
            </Txt>
            <Btn kind="off" onClick={() => void reload()} disabled={loading}>
              {loading ? 'Reading...' : 'Refresh'}
            </Btn>
          </Row>

          {error && (
            <div role="alert" className="mt-6 border-l-2 border-souk-peach pl-3">
              <Txt size={13} lead={20} tone="peach">
                {error}
              </Txt>
            </div>
          )}

          {owned && !loading && stalls.length === 0 && (
            <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
              <Txt size={15} lead={22} tone="ink">
                No agents on the board.
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
                  onChanged={() => void reload()}
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
    </section>
  )
}

// The three figures sit in one divided strip rather than three nested cards. The
// strip is the card's instrument panel, and silver is the only lit value.
function StatCell({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'data' | 'steel'
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-souk-muted">
        {label}
      </div>
      <div
        className={`mt-1 break-words font-mono text-[13px] leading-[17px] tabular-nums ${
          tone === 'data' ? 'text-souk-data' : 'text-souk-steel'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

// The card's actions are one segmented control: the hairlines come from the grid
// gap, so the four controls read as a single footer rather than four loose buttons.
function CardAction({
  variant,
  to,
  href,
  onClick,
  disabled,
  className,
  children,
}: {
  variant?: 'primary' | 'warn'
  to?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const primary = variant === 'primary'
  const warn = variant === 'warn'
  const tone = primary ? 'canvas' : warn ? 'peach' : 'slate'
  const cls = [
    'inline-flex h-10 w-full items-center justify-center rounded-none px-2.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-souk-data',
    primary
      ? 'bg-souk-data text-souk-canvas hover:bg-souk-data/90'
      : warn
        ? 'bg-souk-surface1 hover:bg-souk-peach/10'
        : 'bg-souk-surface1 hover:bg-souk-surface2',
    disabled ? 'cursor-not-allowed opacity-40' : '',
    className ?? '',
  ].join(' ')
  const label = (
    <Txt size={11} lead={16} weight="semibold" tone={tone} className="truncate">
      {children}
    </Txt>
  )
  if (to) {
    return (
      <Link to={to} className={cls}>
        {label}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {label}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {label}
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
    <div className="min-w-0 overflow-hidden rounded-none border border-souk-edge bg-souk-surface1 text-souk-ink [overflow-wrap:anywhere] transition-colors hover:border-souk-hair">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <AgentAvatar size={40} name={agent.name} chainId={agent.chainId} tokenId={agent.tokenId} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <Link to={agentHref} className="min-w-0 truncate">
              <Txt size={18} lead={24} weight="bold" tone="ink">
                {agent.name}
              </Txt>
            </Link>
            <Pill variant={pill.variant}>{pill.text}</Pill>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Txt size={10} lead={14} mono tone="labels" className="truncate">
              {chainLabel(agent.chainId)} / #{agent.tokenId}
            </Txt>
            <span className="h-2.5 w-px bg-souk-hair" aria-hidden="true" />
            <Txt size={10} lead={14} mono tone="muted" className="truncate">
              {categoryLabel(agent.category)}
            </Txt>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-souk-hair/60 border-y border-souk-hair/60 bg-souk-surface2/20">
        <StatCell
          label="Hires, 14d"
          value={hiresValue}
          tone={recentHires.length > 0 ? 'data' : 'steel'}
        />
        <StatCell
          label="Earned"
          value={earnedValue}
          tone={earnedValue === 'nothing yet' ? 'steel' : 'data'}
        />
        <StatCell
          label="Escrow jobs, 30d"
          value={jobsValue}
          tone={recentJobs.length > 0 ? 'data' : 'steel'}
        />
      </div>

      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <span
          title={offMarket ? undefined : verdict.explain}
          className="inline-flex min-w-0 items-center gap-2"
        >
          <Dot tone={VERDICT_TONE[verdict.tone]} size={7} />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-souk-slate">
            {verdict.label}
          </span>
        </span>
        <Txt
          size={10}
          lead={15}
          mono
          tone={feedback ? 'data' : 'muted'}
          className="max-w-[58%] text-right"
        >
          {feedback ?? note}
        </Txt>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-souk-hair/60 bg-souk-hair/60 sm:grid-cols-4">
        <CardAction variant="primary" onClick={() => void onRecheck()} disabled={rechecking}>
          {rechecking ? 'Probing...' : 'Re-check now'}
        </CardAction>
        <CardAction onClick={() => void onBoost()} disabled={boosting || Boolean(offMarket)}>
          {boosting ? 'Reading...' : 'Boost'}
        </CardAction>
        {offMarket ? (
          <CardAction variant="warn" onClick={() => void onSwitch()} disabled={switching}>
            {switching ? 'Relisting...' : 'Relist'}
          </CardAction>
        ) : (
          <CardAction variant="warn" onClick={() => void onSwitch()} disabled={switching}>
            {switching ? 'Unlisting...' : 'Unlist'}
          </CardAction>
        )}
        <CardAction href={registryUrl}>Registry</CardAction>
      </div>
    </div>
  )
}

// the standing invitation the drawing leaves in the last slot of the grid
function AddStallSlot() {
  return (
    <Stack pad={[40, 16, 40, 16]} gap={10} hair className="items-center text-center">
      <Txt size={13} lead={16} mono className="text-souk-muted">
        Agent Souk
      </Txt>
      <Txt size={15} lead={22} weight="semibold" tone="slate">
        Another agent, another listing.
      </Txt>
      <Txt size={12} lead={18} tone="muted">
        Registration writes the listing to the contract, and the first check runs within
        the hour of it landing.
      </Txt>
      <Link
        to="/list"
        className="mt-1 inline-flex h-11 w-fit items-center justify-center rounded-none border border-transparent bg-souk-data px-5 text-souk-canvas transition hover:opacity-90"
      >
        <Txt size={14} lead={20} weight="semibold" tone="canvas">
          List an agent
        </Txt>
      </Link>
    </Stack>
  )
}
