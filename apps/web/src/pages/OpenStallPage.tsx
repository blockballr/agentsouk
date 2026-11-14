import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import type { AgentDetail } from '../core/types'
import { Btn, Dot, Row, SectionHead, Stack, Txt, type DotTone } from '../components/souk'
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
import { endpointRefusal, probeEndpoint, type EndpointProbe } from '../lib/register'
import { useTargetChain } from '../lib/target-chain'
import { useConnectedAccount } from '../lib/use-connected-account'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { connectWallet } from '../lib/wallet-session'

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
  const [endpoint, setEndpoint] = useState('')
  const [endpointSet, setEndpointSet] = useState(false)
  const [tokenId, setTokenId] = useState<string | null>(null)
  // registered in this visit, so the wizard keeps its own closing panel on screen
  const [listedHere, setListedHere] = useState(false)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [reading, setReading] = useState(false)
  const [wizardStep, setWizardStep] = useState<WizardStep>('form')
  const [foundTokenId, setFoundTokenId] = useState<string | null>(null)
  // a link can open on one stage, for example ?stage=agent from the docs
  const [searchParams] = useSearchParams()
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

  const done: Record<StageId, boolean> = {
    owner: Boolean(account),
    agent: endpointSet || Boolean(tokenId),
    identity: Boolean(tokenId),
    rails: Boolean(detail?.verification),
    live: detail?.availability?.shelf === true,
  }
  const current = STAGES.find((stage) => !done[stage.id])?.id ?? 'live'
  const open = picked ?? current
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

      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <ol className="flex gap-2 overflow-x-auto lg:sticky lg:top-4 lg:flex-col lg:overflow-visible">
          {STAGES.map((stage, index) => {
            const state = done[stage.id] ? 'Done' : stage.id === current ? 'Now' : 'Later'
            const on = open === stage.id
            return (
              <li key={stage.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => setPicked(stage.id)}
                  aria-current={on ? 'step' : undefined}
                  className={`flex w-full min-w-[168px] flex-col gap-1 rounded-[12px] border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
                    on ? 'border-souk-data/50 bg-souk-surface2' : 'border-souk-hair bg-souk-surface1 hover:border-souk-data/40'
                  }`}
                >
                  <Row justify="between" align="center" gap={8}>
                    <Txt size={10} lead={14} mono upper tone="muted">
                      Stage {index + 1}
                    </Txt>
                    <Row gap={6} align="center">
                      <Dot tone={done[stage.id] ? 'good' : stage.id === current ? 'held' : 'quiet'} size={7} />
                      <Txt size={10} lead={14} mono upper tone={done[stage.id] ? 'data' : 'muted'}>
                        {state}
                      </Txt>
                    </Row>
                  </Row>
                  <Txt size={14} lead={20} weight="bold" tone="ink">
                    {stage.title}
                  </Txt>
                  <Txt size={11} lead={16} tone="slate">
                    {stage.note}
                  </Txt>
                </button>
              </li>
            )
          })}
        </ol>

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
              endpoint={endpoint || searchParams.get('endpoint') || ''}
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
      </div>

      <Stack gap={6}>
        <Txt size={12} lead={18} tone="slate">
          Building with your own stack? The manifest we read from a listing is documented under Docs, so a
          card you already publish does not need changing.
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
    </Stack>
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
  const [failed, setFailed] = useState(false)
  return (
    <Panel
      title="Connect the owner wallet"
      lead="This wallet signs the registration, so the registry records it as the owner. It is also where the money from hires is paid unless the agent card names its own wallet."
    >
      {account ? (
        <Fact label="Owner" value={account} note="Switch wallets in your wallet app to list under another owner." />
      ) : (
        <Row gap={10} align="center" className="flex-wrap">
          <Btn
            kind="primary"
            onClick={() => {
              setFailed(false)
              connectWallet().catch(() => setFailed(true))
            }}
          >
            Connect wallet
          </Btn>
          {failed && (
            <Txt size={12} lead={18} tone="peach">
              The wallet did not connect. Try again.
            </Txt>
          )}
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
        <StudioSteps chainId={chainId} onContinue={() => setWay('bring')} />
      )}
    </Panel>
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
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <RegisterWizard
              chainId={chainId}
              onStep={setStep}
              onChecks={setChecks}
              initialEndpoint={endpoint || undefined}
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
