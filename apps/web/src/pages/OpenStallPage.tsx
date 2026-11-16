import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CATEGORIES, shortAddress } from '@agora/core'
import type { AgentDetail } from '../core/types'
import { AgentAvatar, Btn, Dot, Row, SectionHead, Stack, Txt, type DotTone } from '../components/souk'
import { RegisterWizard, initialChecks, type WizardStep } from '../components/RegisterWizard'
import {
  GasRequirement,
  LISTING_GUIDE,
  LookupSection,
  ReviewRequestSection,
  SetAndEarnNote,
} from '../components/ListingParts'
import { QuestStrip } from '../components/QuestStrip'
import { StudioSteps } from '../components/StudioSteps'
import { VerificationLoop, type CheckLine, type GasReadiness } from '../components/VerificationLoop'
import { agentRails, railGaps, railSourceLabel } from '../lib/agent-rails'
import { getAgentDetail, getAgentsByOwner, type OwnedAgent } from '../lib/api'
import { chainLabel, explorerAddressUrl, registryFor } from '../lib/contracts'
import { isOperatedByAgentSouk } from '../lib/first-party'
import { inputClass } from '../lib/form-classes'
import { endpointRefusal, probeEndpoint, readAgentCard, type EndpointProbe } from '../lib/register'
import { useTargetChain } from '../lib/target-chain'
import { useConnectedAccount } from '../lib/use-connected-account'
import { ConnectTimeoutError, connectWalletWithTimeout } from '../lib/wallet-session'
import { verdictFor, type VerdictTone } from '../lib/verdict'

const STAGES = [
  { id: 'owner', title: 'Owner', note: 'The wallet that owns the listing' },
  { id: 'agent', title: 'Agent', note: 'An endpoint buyers can reach' },
  { id: 'identity', title: 'Identity', note: 'One registry transaction' },
  { id: 'rails', title: 'Rails', note: 'What it can sell here' },
  { id: 'live', title: 'Live', note: 'On the shelf' },
] as const

type StageId = (typeof STAGES)[number]['id']

const VERDICT_DOT: Record<VerdictTone, DotTone> = { good: 'good', held: 'held', bad: 'bad', none: 'quiet' }

// a hosted agent answers from this marketplace, which holds its quote key
const hostedHere = (endpoint: string) => endpoint.includes('/api/built/')

// Getting listed is one path. Each stage is finished by something the wallet,
// the registry or the verifier reports, so a seller who leaves comes back to
// the stage they stopped at, on any device.
export function OpenStallPage() {
  const account = useConnectedAccount()
  const chainId = useTargetChain()?.chainId ?? null

  const [owned, setOwned] = useState<OwnedAgent[] | null>(null)
  const [tokenId, setTokenId] = useState<string | null>(null)
  // registered in this visit, so the wizard keeps its own closing panel on screen
  const [listedHere, setListedHere] = useState(false)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [reading, setReading] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('form')
  const [foundTokenId, setFoundTokenId] = useState<string | null>(null)
  const [searchParams] = useSearchParams()
  // a link that carries an endpoint has already answered the agent stage
  const [endpoint, setEndpoint] = useState(() => searchParams.get('endpoint')?.trim() ?? '')
  const [endpointSet, setEndpointSet] = useState(() => endpoint.length > 0)
  // a link can ask for one stage, for example ?stage=agent from the docs
  const [picked, setPicked] = useState<StageId | null>(() => {
    const asked = searchParams.get('stage')
    return STAGES.find((stage) => stage.id === asked)?.id ?? null
  })

  // the newest listing the wallet owns is where a returning seller resumes
  useEffect(() => {
    setOwned(null)
    setTokenId(null)
    setListedHere(false)
    setDetail(null)
    if (!account) return
    let cancelled = false
    getAgentsByOwner(account)
      .then((result) => {
        if (cancelled) return
        setOwned(result.agents)
        const newest = [...result.agents].sort((a, b) => Number(b.tokenId) - Number(a.tokenId))[0]
        if (newest) setTokenId(newest.tokenId)
      })
      .catch(() => {
        if (!cancelled) setOwned([])
      })
    return () => {
      cancelled = true
    }
  }, [account])

  const readDetail = useCallback(async () => {
    if (chainId === null || !tokenId) return
    setReading(true)
    try {
      setDetail(await getAgentDetail(String(chainId), tokenId))
    } catch {
      setDetail(null)
    }
    setReading(false)
  }, [chainId, tokenId])

  useEffect(() => {
    setDetail(null)
    void readDetail()
  }, [readDetail])

  // the card a pasted endpoint serves, so the preview shows the agent's own name,
  // words and face before the listing exists; the detail read replaces it once the
  // index has the registration
  const [card, setCard] = useState<PreviewCard | null>(null)
  useEffect(() => {
    const url = endpoint.trim()
    if (!url || endpointRefusal(url)) {
      setCard(null)
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      void readAgentCard(url).then((read) => {
        if (!live) return
        setCard(read ? { name: read.name, description: read.description, image: read.image } : null)
      })
    }, 400)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [endpoint])

  const done: Record<StageId, boolean> = {
    owner: Boolean(account),
    agent: endpointSet || Boolean(tokenId),
    identity: Boolean(tokenId),
    rails: Boolean(detail?.verification),
    live: detail?.availability?.shelf === true,
  }
  const current = STAGES.find((stage) => !done[stage.id])?.id ?? 'live'
  // the path is walked in order: a stage opens once every stage before it is
  // done, so a link or a click can go back but never ahead of the seller
  const reach = STAGES.findIndex((stage) => stage.id === current)
  const reachable = (id: StageId) => STAGES.findIndex((stage) => stage.id === id) <= reach
  const open = picked && reachable(picked) ? picked : current
  const ownedAgent = owned?.find((agent) => agent.tokenId === tokenId) ?? null
  // a passport link opens the path with the guide for its listing step
  const questing = searchParams.get('quest') === 'stall'
  const guide = LISTING_GUIDE[done.identity ? 'listed' : open === 'identity' ? wizardStep : 'form']

  function listAnother() {
    setTokenId(null)
    setListedHere(false)
    setDetail(null)
    setEndpoint('')
    setEndpointSet(false)
    setWizardStep('form')
    setPicked(null)
  }

  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Open a stall" note="FIVE STAGES" />

      <StageBar done={done} current={current} open={open} reachable={reachable} onPick={setPicked} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Stack gap={20} className="min-w-0">
          {questing && (open === 'agent' || open === 'identity') && (
            <QuestStrip
              label={`Open your stall · ${guide.count}`}
              text={guide.text}
              done={done.identity}
              stamp="stall"
              className="max-w-[768px]"
            />
          )}
          {open === 'owner' && <OwnerStage account={account} />}
          {open === 'agent' && (
            <AgentStage
              endpoint={endpoint}
              chainId={chainId}
              listed={Boolean(tokenId)}
              onEndpoint={setEndpoint}
              onContinue={() => {
                setEndpointSet(true)
                setPicked(null)
              }}
            />
          )}
          {open === 'identity' && (
            <IdentityStage
              account={account}
              chainId={chainId}
              endpoint={endpoint}
              tokenId={tokenId}
              onStep={setWizardStep}
              ownedAgent={ownedAgent}
              showWizard={!tokenId || listedHere}
              onListed={(id) => {
                setListedHere(true)
                setTokenId(id)
              }}
            />
          )}
          {open === 'rails' && (
            <RailsStage
              chainId={chainId}
              tokenId={tokenId}
              detail={detail}
              reading={reading}
              onCheck={() => void readDetail()}
            />
          )}
          {/* for a listing the index never picked up: check the registry directly, then ask a person */}
          {open === 'rails' && (
            <>
              <LookupSection chainId={chainId} onFound={setFoundTokenId} />
              <ReviewRequestSection
                key={foundTokenId ?? tokenId ?? 'none'}
                defaultTokenId={foundTokenId ?? tokenId ?? ''}
              />
            </>
          )}
          {open === 'live' && (
            <LiveStage chainId={chainId} tokenId={tokenId} detail={detail} onAnother={listAnother} />
          )}
        </Stack>

        <ListingPreview
          account={account}
          endpoint={endpoint || detail?.a2a_endpoint || ''}
          tokenId={tokenId}
          detail={detail}
          card={card}
          shelf={done.live}
        />
      </div>
    </Stack>
  )
}

function StageBar({
  done,
  current,
  open,
  reachable,
  onPick,
}: {
  done: Record<StageId, boolean>
  current: StageId
  open: StageId
  reachable: (id: StageId) => boolean
  onPick: (id: StageId) => void
}) {
  return (
    <nav aria-label="Listing stages">
      <ol className="grid grid-cols-5 gap-1.5 rounded-[16px] border border-souk-hair bg-souk-surface1 p-1.5">
        {STAGES.map((stage, index) => {
          const locked = !reachable(stage.id)
          const on = open === stage.id
          const state = done[stage.id] ? 'Done' : stage.id === current ? 'Now' : 'Locked'
          return (
            <li key={stage.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(stage.id)}
                disabled={locked}
                aria-current={on ? 'step' : undefined}
                aria-label={`Stage ${index + 1}, ${stage.title}, ${state.toLowerCase()}`}
                title={stage.note}
                className={`flex w-full min-w-0 flex-col items-center gap-1 rounded-[11px] border px-1 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data sm:flex-row sm:items-center sm:gap-1.5 sm:px-2 ${
                  on
                    ? 'border-souk-data/50 bg-souk-surface2'
                    : locked
                      ? 'cursor-not-allowed border-souk-hair bg-souk-surface1 opacity-50'
                      : 'border-souk-hair bg-souk-surface1 hover:border-souk-data/40'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px] ${
                    done[stage.id]
                      ? 'border-souk-data/40 bg-souk-data/15 text-souk-data'
                      : stage.id === current
                        ? 'border-souk-data/50 text-souk-ink'
                        : 'border-souk-hair text-souk-muted'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-1.5">
                  <span className="w-full truncate text-center text-[10px] font-semibold leading-4 text-souk-ink sm:w-auto sm:text-left sm:text-[11px]">
                    {stage.title}
                  </span>
                  <span className="hidden truncate font-mono text-[9px] uppercase tracking-[0.08em] text-souk-muted sm:block">
                    {state}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type PreviewCard = { name?: string; description?: string; image?: string }

const PREVIEW_RAIL_TITLE = { vault: 'Vault hire', job: 'Escrow job', call: 'Direct call' } as const

// the shelf card the seller is building, filling in as each stage reports: the
// wallet from stage one, the card served by the endpoint from stage two, the
// registry id from three, the rails from four and the shelf from five
function ListingPreview({
  account,
  endpoint,
  tokenId,
  detail,
  card,
  shelf,
}: {
  account: string | null
  endpoint: string
  tokenId: string | null
  detail: AgentDetail | null
  card: PreviewCard | null
  shelf: boolean
}) {
  const name = detail?.name ?? card?.name ?? 'Your agent'
  const description =
    detail?.description ?? card?.description ?? 'The card description appears here once the endpoint answers.'
  const image = detail?.image_url ?? card?.image ?? null
  const owner = account ?? detail?.owner_address ?? null
  const category =
    detail?.category && detail.category !== 'general'
      ? CATEGORIES.find((c) => c.key === detail.category)?.label ?? detail.category
      : null
  const house = detail
    ? isOperatedByAgentSouk(detail.owner_address) || isOperatedByAgentSouk(detail.agent_wallet)
    : false
  const rails = detail ? agentRails(detail, house) : []
  const gaps = detail ? railGaps(detail, house) : []
  const verdict = detail ? verdictFor(detail.chain_id, detail.verification) : null
  const order = ['vault', 'job', 'call'] as const

  return (
    <aside className="xl:sticky xl:top-24">
      <Stack surface gap={12} pad={[14, 14, 14, 14]}>
        <Row justify="between" align="center" gap={8}>
          <Txt size={10} lead={14} weight="bold" upper tone="muted">
            Your listing
          </Txt>
          <Txt size={9} lead={12} mono upper tone="labels">
            Buyer view
          </Txt>
        </Row>

        <article className="rounded-[16px] border border-souk-hair bg-souk-surface1 p-3.5">
          <div className="flex items-start gap-3">
            <AgentAvatar
              size={46}
              name={name}
              imageUrl={image}
              chainId={detail?.chain_id ?? undefined}
              tokenId={tokenId ?? undefined}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-souk-muted">
                {category ?? 'No category yet'}
              </div>
              <div
                className={`truncate font-serif text-[18px] font-semibold leading-[25px] ${
                  detail?.name ?? card?.name ? 'text-souk-ink' : 'text-souk-muted'
                }`}
              >
                {name}
              </div>
              <div className="truncate font-mono text-[10px] leading-4 text-souk-muted">
                {owner ? shortAddress(owner) : 'Wallet not connected'}
              </div>
            </div>
          </div>

          <div
            className={`mt-2.5 truncate font-mono text-[12px] ${endpoint ? 'text-souk-ink' : 'text-souk-muted'}`}
            title={endpoint || undefined}
          >
            {endpoint || 'Endpoint not set'}
          </div>

          <span className="mt-2 inline-flex" title={verdict?.explain}>
            <Row align="center" gap={7}>
              <Dot
                tone={shelf ? 'verified' : verdict ? VERDICT_DOT[verdict.tone] : 'quiet'}
                size={7}
              />
              <Txt size={11} lead={16} tone="slate">
                {shelf ? 'On the shelf' : verdict ? verdict.label : 'Not registered yet'}
              </Txt>
            </Row>
          </span>

          <p className="mt-2 line-clamp-3 text-[12px] leading-[1.5] text-souk-slate">{description}</p>

          <div className="mt-3 space-y-1.5 border-t border-souk-hair pt-2.5">
            {order.map((kind) => {
              const rail = rails.find((r) => r.kind === kind)
              const gap = gaps.find((g) => g.kind === kind)
              return (
                <Row key={kind} justify="between" align="center" gap={8}>
                  <Row gap={6} align="center">
                    <Dot tone={rail ? 'good' : 'quiet'} size={6} />
                    <Txt size={11} lead={16} tone={rail ? 'ink' : 'muted'}>
                      {rail?.title ?? gap?.title ?? PREVIEW_RAIL_TITLE[kind]}
                    </Txt>
                  </Row>
                  <Txt size={9} lead={12} mono upper tone={rail ? 'data' : 'muted'}>
                    {rail ? 'Ready' : detail ? 'Closed' : 'Pending'}
                  </Txt>
                </Row>
              )
            })}
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-souk-hair pt-2 font-mono text-[10px] text-souk-muted">
            <span className="whitespace-nowrap text-souk-data">{tokenId ? `#${tokenId}` : 'no token yet'}</span>
            <span>{shelf ? 'Live' : detail ? 'Registered' : 'Draft'}</span>
          </div>
        </article>

        <Txt size={10} lead={15} tone="muted">
          This is the card buyers see. It fills in as each stage reports, and nothing on it is guessed.
        </Txt>
      </Stack>
    </aside>
  )
}

function Panel({ title, lead, children }: { title: string; lead: string; children?: React.ReactNode }) {
  return (
    <Stack surface gap={14} pad={[20, 22, 20, 22]}>
      <Stack gap={4}>
        <Txt size={18} lead={26} weight="bold" tone="ink">
          {title}
        </Txt>
        <Txt size={13} lead={20} tone="slate" className="max-w-[68ch]">
          {lead}
        </Txt>
      </Stack>
      {children}
    </Stack>
  )
}

function Fact({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <Stack gap={2} className="min-w-0">
      <Txt size={10} lead={14} weight="bold" upper tone="muted">
        {label}
      </Txt>
      <Txt size={13} lead={20} mono tone="ink" className="break-all">
        {value}
      </Txt>
      {note && (
        <Txt size={11} lead={16} tone="steel">
          {note}
        </Txt>
      )}
    </Stack>
  )
}

function OwnerStage({ account }: { account: string | null }) {
  const [connecting, setConnecting] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function connect() {
    setConnecting(true)
    setNote(null)
    try {
      await connectWalletWithTimeout()
    } catch (e) {
      // a refusal in the wallet speaks for itself; only a connect that reached nobody needs words here
      if (e instanceof ConnectTimeoutError) setNote(e.message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Panel
      title="The wallet that owns the listing"
      lead="It signs the registration, and the registry records it as the owner. Hires pay it unless the agent card names its own wallet."
    >
      {account ? (
        <Fact label="Owner" value={account} note="Switch wallets in your wallet app to list under another owner." />
      ) : (
        <Row gap={12} align="center" className="flex-wrap">
          <Btn kind="primary" onClick={() => void connect()} disabled={connecting}>
            {connecting ? 'Connecting' : 'Connect wallet'}
          </Btn>
          <Txt size={12} lead={18} tone="steel">
            {note ?? 'This step closes on its own once the wallet is connected.'}
          </Txt>
        </Row>
      )}
    </Panel>
  )
}

function AgentStage({
  endpoint,
  chainId,
  listed,
  onEndpoint,
  onContinue,
}: {
  endpoint: string
  chainId: number | null
  listed: boolean
  onEndpoint: (value: string) => void
  onContinue: () => void
}) {
  const [way, setWay] = useState<'bring' | 'make'>('bring')
  const [probe, setProbe] = useState<EndpointProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const trimmed = endpoint.trim()
  const fault = trimmed ? endpointRefusal(trimmed) : null

  async function check() {
    setProbe(null)
    setProbing(true)
    try {
      setProbe(await probeEndpoint(trimmed))
    } finally {
      setProbing(false)
    }
  }

  return (
    <Panel
      title="Bring an agent, or make one"
      lead="Both ways end in the same thing: an HTTPS endpoint that answers, with an agent card beside it. That endpoint is what the verifier calls and what buyers pay."
    >
      {listed && (
        <Txt size={12} lead={18} tone="steel">
          This wallet already has a listing. Its stages are shown as done; use List another agent on the last stage to
          start again.
        </Txt>
      )}
      <Row gap={8} align="center" className="flex-wrap">
        <Btn kind={way === 'bring' ? 'primary' : 'off'} aria-pressed={way === 'bring'} onClick={() => setWay('bring')}>
          I have an agent
        </Btn>
        <Btn kind={way === 'make' ? 'primary' : 'off'} aria-pressed={way === 'make'} onClick={() => setWay('make')}>
          I need to make one
        </Btn>
      </Row>

      {way === 'bring' ? (
        <Stack gap={10}>
          <label htmlFor="stall-endpoint">
            <Txt size={10} lead={14} weight="bold" upper tone="muted">
              Endpoint
            </Txt>
          </label>
          <input
            id="stall-endpoint"
            type="url"
            value={endpoint}
            onChange={(e) => {
              onEndpoint(e.target.value)
              setProbe(null)
            }}
            placeholder="https://your-agent.example/a2a"
            className={`${inputClass} font-mono`}
          />
          <Txt size={11} lead={16} tone={fault ? 'peach' : 'steel'}>
            {fault ?? 'Paste the messaging endpoint buyers call, usually /a2a, not the card link.'}
          </Txt>
          <Row gap={8} align="center" className="flex-wrap">
            <Btn kind="off" disabled={!trimmed || Boolean(fault) || probing} onClick={() => void check()}>
              {probing ? 'Checking' : 'Check it answers'}
            </Btn>
            <Btn kind="primary" disabled={!trimmed || Boolean(fault)} onClick={onContinue}>
              Continue to identity
            </Btn>
          </Row>
          {probe && (
            <Row gap={8} align="start">
              <span className="mt-[6px]">
                <Dot tone={probe.state === 'answered' ? 'good' : probe.state === 'refused' ? 'bad' : 'quiet'} size={8} />
              </span>
              <Txt size={12} lead={18} tone="slate">
                {probe.detail}
              </Txt>
            </Row>
          )}
        </Stack>
      ) : (
        <Stack gap={14}>
          <StudioSteps chainId={chainId} onContinue={() => setWay('bring')} />
          <ManifestLinks />
        </Stack>
      )}
    </Panel>
  )
}

// a seller who builds outside Studio still publishes the one card the
// marketplace reads, so the manifest links sit on the make path, not under
// every stage
function ManifestLinks() {
  return (
    <Stack gap={4} pad={[12, 16, 12, 16]} radius={12} hair>
      <Txt size={12} lead={18} tone="slate">
        Building with your own stack? Publish the same card we read from any listing, so nothing about
        your agent has to change.
      </Txt>
      <Row gap={16} align="center" className="flex-wrap">
        <Link to="/build/manifest" className="font-mono text-[11px] text-souk-sky transition hover:text-souk-ink">
          Generate a manifest
        </Link>
        <a
          href="https://docs.agentsouk.xyz/manifest"
          className="font-mono text-[11px] text-souk-sky transition hover:text-souk-ink"
        >
          Read the manifest reference
        </a>
      </Row>
    </Stack>
  )
}

function IdentityStage({
  account,
  chainId,
  endpoint,
  tokenId,
  ownedAgent,
  showWizard,
  onStep,
  onListed,
}: {
  account: string | null
  chainId: number | null
  endpoint: string
  tokenId: string | null
  ownedAgent: OwnedAgent | null
  showWizard: boolean
  onStep: (step: WizardStep) => void
  onListed: (agentId: string) => void
}) {
  const [checks, setChecks] = useState<CheckLine[] | null>(() => initialChecks('call'))
  const [gas, setGas] = useState<GasReadiness | null>(null)
  const registry = chainId === null ? null : registryFor(chainId) ?? null
  const hosted = hostedHere(endpoint)

  // once the form is sent the verifier card is the only thing that answers, and
  // on a wide screen it sits in the side rail, out of view of the button
  const [step, setStep] = useState<WizardStep>('form')
  const focused = useRef(false)
  useEffect(() => {
    onStep(step)
    if (step === 'form') {
      focused.current = false
      return
    }
    if (focused.current) return
    const card = document.getElementById('verifier-check')
    if (!card) return
    focused.current = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    card.focus({ preventScroll: true })
  }, [step, onStep])

  return (
    <Stack gap={20}>
      <Panel
        title="The identity you are about to write"
        lead="Registration is one transaction from the owner wallet. It mints the ERC-8004 record that every marketplace reads, so check who holds what before you sign."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Fact
            label="Owner wallet"
            value={account ? shortAddress(account) : 'Not connected'}
            note="Owns the registry record and can change or delist it."
          />
          <Fact
            label="Agent wallet"
            value={ownedAgent?.agentWallet ? shortAddress(ownedAgent.agentWallet) : tokenId ? 'Not named' : 'Read from the card'}
            note="Where hires are paid. The card names it; without one, the owner wallet is paid."
          />
          <Fact
            label="Signing key"
            value={hosted ? 'Held by Agent Souk' : 'Yours'}
            note={
              hosted
                ? 'We sign job quotes for a hosted agent. Export or revoke the key from Account at any time.'
                : 'Agent Souk holds no key for this agent. Your endpoint signs its own quotes.'
            }
          />
          <Fact
            label="Registry"
            value={
              chainId !== null && registry ? (
                <a
                  href={explorerAddressUrl(chainId, registry)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-souk-data"
                >
                  {shortAddress(registry)}
                </a>
              ) : (
                'Checking the network'
              )
            }
            note={chainId !== null ? chainLabel(chainId) : undefined}
          />
          {tokenId && <Fact label="Token id" value={`#${tokenId}`} note="The registry id of this agent." />}
        </div>
      </Panel>

      {showWizard && <SetAndEarnNote />}

      {showWizard &&
        (chainId === null ? (
          <Txt size={13} lead={20} tone="steel">
            Checking the network before the registration step.
          </Txt>
        ) : (
          <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <RegisterWizard
              chainId={chainId}
              onStep={setStep}
              onChecks={setChecks}
              initialEndpoint={endpoint || undefined}
              endpointLocked={Boolean(endpoint)}
              onListed={onListed}
            />
            <Stack gap={20}>
              <GasRequirement chainId={chainId} onState={setGas} />
              {checks && <VerificationLoop checks={checks} gas={gas} />}
            </Stack>
          </div>
        ))}
    </Stack>
  )
}

function RailsStage({
  chainId,
  tokenId,
  detail,
  reading,
  onCheck,
}: {
  chainId: number | null
  tokenId: string | null
  detail: AgentDetail | null
  reading: boolean
  onCheck: () => void
}) {
  if (!tokenId || chainId === null) {
    return (
      <Panel
        title="Rails come after the registration"
        lead="Once the agent has a registry id, the verifier calls its endpoint and this stage shows which of the three rails it can sell on."
      />
    )
  }

  if (!detail) {
    return (
      <Panel
        title={reading ? 'Reading the listing' : 'Not in the index yet'}
        lead={
          reading
            ? `Reading agent #${tokenId} from the marketplace index.`
            : `Agent #${tokenId} is registered, and the marketplace index has not picked it up yet. That usually takes a few minutes.`
        }
      >
        {!reading && (
          <Row gap={10} align="center" className="flex-wrap">
            <Btn kind="primary" onClick={onCheck}>
              Check again
            </Btn>
          </Row>
        )}
      </Panel>
    )
  }

  const house = isOperatedByAgentSouk(detail.owner_address) || isOperatedByAgentSouk(detail.agent_wallet)
  const rails = agentRails(detail, house)
  const gaps = railGaps(detail, house)
  const verdict = verdictFor(detail.chain_id, detail.verification)
  // shelf order, whether a rail is open or closed
  const order = ['vault', 'job', 'call'] as const

  return (
    <Panel
      title="What this agent can sell here"
      lead="The verifier's result, rail by rail, in shelf order. A closed rail names the first thing it is missing; fix that in the agent card and the next check opens it."
    >
      <Row gap={8} align="center" className="flex-wrap">
        <Dot tone={VERDICT_DOT[verdict.tone]} size={8} />
        <Txt size={13} lead={20} weight="semibold" tone="ink">
          {verdict.label}
        </Txt>
        <Txt size={12} lead={18} tone="steel">
          {verdict.explain}
        </Txt>
      </Row>

      <ul className="grid gap-3 md:grid-cols-3">
        {order.map((kind) => {
          const rail = rails.find((r) => r.kind === kind)
          const gap = gaps.find((g) => g.kind === kind)
          if (!rail && !gap) return null
          return (
            <li key={kind} className="flex">
              <Stack gap={6} pad={[14, 16, 14, 16]} radius={12} className="w-full border border-souk-hair bg-souk-surface2">
                <Row justify="between" align="center" gap={8}>
                  <Txt size={14} lead={20} weight="bold" tone="ink">
                    {rail?.title ?? gap?.title}
                  </Txt>
                  <Row gap={6} align="center">
                    <Dot tone={rail ? 'good' : 'quiet'} size={7} />
                    <Txt size={10} lead={14} mono upper tone={rail ? 'data' : 'muted'}>
                      {rail ? 'Ready' : 'Closed'}
                    </Txt>
                  </Row>
                </Row>
                <Txt size={12} lead={18} tone="slate">
                  {rail ? rail.body : gap?.missing}
                </Txt>
                {rail && (
                  <Txt size={10} lead={14} mono upper tone="labels">
                    {railSourceLabel(rail.source)}
                  </Txt>
                )}
              </Stack>
            </li>
          )
        })}
      </ul>

      <Row gap={10} align="center" className="flex-wrap">
        <Btn kind="off" disabled={reading} onClick={onCheck}>
          {reading ? 'Reading' : 'Read it again'}
        </Btn>
      </Row>
    </Panel>
  )
}

function LiveStage({
  chainId,
  tokenId,
  detail,
  onAnother,
}: {
  chainId: number | null
  tokenId: string | null
  detail: AgentDetail | null
  onAnother: () => void
}) {
  const onShelf = detail?.availability?.shelf === true
  if (!tokenId || chainId === null) {
    return (
      <Panel
        title="Not live yet"
        lead="The listing goes on the shelf after it is registered and the verifier has reached its endpoint."
      />
    )
  }
  return (
    <Panel
      title={onShelf ? `${detail?.name ?? 'Your agent'} is on the shelf` : 'Registered, not on the shelf yet'}
      lead={
        onShelf
          ? 'Buyers can find it and hire it on the rails shown in the last stage. The seller console is where hires and payouts appear.'
          : detail?.availability?.reason ??
            'The verifier has not finished with this listing. The rails stage shows what it has found so far.'
      }
    >
      <Row gap={10} align="center" className="flex-wrap">
        <Link to={`/agents/${chainId}/${tokenId}`}>
          <Btn kind="primary">View the listing</Btn>
        </Link>
        <Link to="/seller">
          <Btn kind="off">Open the seller console</Btn>
        </Link>
        <Btn kind="off" onClick={onAnother}>
          List another agent
        </Btn>
      </Row>
    </Panel>
  )
}
