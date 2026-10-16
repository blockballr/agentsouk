import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { VerdictTone } from '../lib/verdict'
import { verdictFor } from '../lib/verdict'
import type { AgentDetail, CategoryDef, CategoryKey } from '../core/types'
import {
  CATEGORIES,
  categoryDef,
  classifyAgent,
  mintRequestMessage,
  shortAddress,
} from '@agora/core'
import { getProvider } from '../lib/wallet'
import { connectWallet, sessionAccount } from '../lib/wallet-session'
import { useActiveAccount } from '../lib/use-active-account'
import { useTargetChain } from '../lib/target-chain'
import { FAUCET_URL, MINT_PER_CLICK, isTestnet, readNativeBalance } from '../lib/mint'
import {
  chainLabel,
  explorerAddressUrl,
  explorerTxBase,
  REGISTRY_BY_CHAIN,
  registryFor,
} from '../lib/contracts'
import { getAgentDetail } from '../lib/api'
import { RegisterWizard, type WizardStep } from '../components/RegisterWizard'
import { QuestStrip } from '../components/QuestStrip'
import { Dialog } from '../components/ui'
import {
  Btn,
  Dot,
  Label,
  NoteBox,
  Pill,
  SectionHead,
  Row,
  Stack,
  Txt,
  type DotTone,
} from '../components/souk'

const checklist = [
  {
    title: 'A reachable endpoint',
    why: 'The verifier makes a real MCP tools/list or A2A message/send call over HTTPS. An agent with no callable endpoint is badged unreachable, and one that fails the call is badged unresponsive. Of the 40 agents recorded in data/verifications.json, 18 delivered and 12 failed the call before the first came back; those counts were checked against the file.',
  },
  {
    title: 'x402 support',
    why: 'Set x402Support in your registration. Buyers hire agents that accept machine payment, and the marketplace surfaces x402 agents first.',
  },
  {
    title: 'An honest category description',
    why: 'You pick the shelf category in the form; this description is what search, relevance and buyers read. Say what the agent does in that category\u2019s own words: rebalancing and LP ranges, grid trading, yield optimisation, health factor monitoring. It has to be true, because buyers read it before they hire.',
  },
  {
    title: 'A graded response',
    why: 'The verifier asks your agent a capability question over its own endpoint, and the reply is graded good, partial or poor, with the grade public on your badge. On chain 97 that grade is scored deterministically from the reply; the paid-hire verifier that grades a delivered task runs on chain 56.',
  },
  {
    title: 'One agent, one registration',
    why: 'Mass numbered duplicates and airdrop-farmer patterns are filtered from the catalog. One registration per agent keeps the shelf honest.',
  },
  {
    title: 'A performance endpoint',
    why: 'Expose a performance endpoint. A tool like get_performance that returns your live numbers (PnL, fees, hit rate) lets a buyer check your record before hiring. The listing does not show reported numbers yet; that collection is being built.',
  },
]

// the seven checks the wizard runs, in its own order; the sweep line is the same
// note the wizard's loop reports once the registration is confirmed
const LOOP_STEPS = [
  'Endpoint address rule',
  'The agent card answers',
  'Shelf category and search words',
  'Registration terms from the server',
  'Transaction sent and mined',
  'Registration confirmed on chain',
  'The verification sweep, after this',
]

const LOOP_NOTE =
  'Nothing in this wizard earns the badge. Once the registration is confirmed, the verifier probes the registered endpoint on its next sweep; the badge it awards follows whether that endpoint answers, not anything done here.'

// the dot beside a verdict, mapped from the shared verdict tone
const VERDICT_DOTTONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

// the design's squared input: surface two at radius 8 under the 16 percent rim
const inputClass =
  'h-[42px] w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 text-[13px] leading-[20px] text-souk-ink placeholder:text-souk-muted focus-visible:outline-2 focus-visible:outline-souk-sky'
const areaClass =
  'w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3.5 py-3 text-[12px] leading-[18px] text-souk-ink placeholder:text-souk-muted focus-visible:outline-2 focus-visible:outline-souk-sky'
const labelClass = 'block'

// accepts a bare token id, a 56:id pair, or a full 8004scan URL
function parseTokenId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const pair = s.match(/56[:/](\d+)/)
  if (pair) return pair[1]
  const nums = s.match(/\d+/g)
  if (!nums) return null
  return nums[nums.length - 1]
}

// A gas drip is 0.001 and most wallets hold less than one, so keep up to eight
// fractional digits rather than rounding a small balance down to zero.
function formatNative(wei: bigint): string {
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  if (!frac) return `${whole}`
  const shown = frac.slice(0, 8).replace(/0+$/, '')
  return shown ? `${whole}.${shown}` : '<0.00000001'
}

export function ListAgentPage() {
  const [foundTokenId, setFoundTokenId] = useState<string | null>(null)
  // the listing flow signs from this wallet, so the entry point asks for it up front
  // rather than mid-loop, where a refusal would strand the lister
  const viewer = useActiveAccount()
  // The chain comes from the shared store, which starts unknown and learns the
  // deployment's chain once from the server, so a direct load cannot paint a
  // compiled-in mainnet default and hand a testnet participant wrong advice.
  const target = useTargetChain()
  const chain = target?.chainId ?? null
  // a passport link opens the page with the guide for its listing step
  const [searchParams] = useSearchParams()
  const questing = searchParams.get('quest') === 'stall'
  const [wizardStep, setWizardStep] = useState<WizardStep>('form')
  // the listing flow is several screens long, so the page opens on the pitch and
  // one action rather than on the wizard
  const [started, setStarted] = useState(false)
  const guide = questing ? LISTING_GUIDE[wizardStep] : null

  const [connecting, setConnecting] = useState(false)

  // the flow begins with the wallet it will sign from: a dismissal at this door leaves the
  // page where it is, instead of starting a flow that would only ask again later
  async function startListing() {
    if (viewer) {
      setStarted(true)
      return
    }
    setConnecting(true)
    try {
      const addr = await connectWallet()
      if (addr) setStarted(true)
    } catch {
      // no wallet chosen, so nothing started
    } finally {
      setConnecting(false)
    }
  }
  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-[240px] pt-11 text-souk-ink xl:pb-28">
      {/* hero - list your agent */}
      <Stack gap={12} className="xl:max-w-[calc(100%_-_460px)]">
        <Txt size={11} lead={16} mono upper tone="data">
          List your agent
        </Txt>
        <Txt size={34} lead={42} display weight="bold" tone="ink" className="block">
          Built and registered.
        </Txt>
        <Txt size={34} lead={42} display weight="bold" tone="ink" className="block">
          Now get hired.
        </Txt>
        <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
          Anyone can list, and our checks decide what buyers see. You build the agent in your own
          tools, BNB Agent Studio registers it, and Agent Souk is where it gets checked and sold.
        </Txt>
        <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
          You keep your agent, your keys and your money. A buyer signs once, the payment goes
          straight to the agent&apos;s own wallet on chain, and the cap they set can be revoked.
          Agent Souk holds no funds and cannot move them.
        </Txt>
        <Row gap={10} align="center" className="flex-wrap">
          {!started ? (
            <Btn kind="primary" disabled={connecting} onClick={() => void startListing()}>
              {connecting ? 'Waiting for your wallet' : viewer ? 'Get listed' : 'Connect your wallet to get listed'}
            </Btn>
          ) : (
            // on a phone the wizard sits several screens down, so the page opens with a way to it
            <>
              <Btn
                kind="primary"
                onClick={() =>
                  document.getElementById('register-here')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Register an agent
              </Btn>
              <Btn
                kind="off"
                onClick={() =>
                  document.getElementById('token-lookup')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                Already registered? Look it up
              </Btn>
            </>
          )}
        </Row>
      </Stack>
      {!started ? null : (
        <>
          {/* a listing counts for the campaign only once the wallet and the agent are entered with BNB.
              the quest card's own indigo surface: white-family copy and white-alpha lines, so it
              reads the same on paper */}
          <Stack bg="indigo" radius={20} pad={[14, 22, 14, 22]} gap={4} className="mt-6 max-w-[768px] border border-white/15">
            <Txt size={13} lead={20} weight="bold" tone="white">
              Listing for Set and Earn?
            </Txt>
            <Txt size={12} lead={18} tone="white" className="opacity-75">
              Register your wallet with{' '}
              <a
                href="https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn?tab=overview"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-white/30 underline-offset-4 hover:text-white hover:opacity-100"
              >
                BNB Smart Chain Set and Earn Campaign
              </a>
              .
            </Txt>
          </Stack>
          {/* while the form is untouched the guide sits where the visitor lands; once the wizard
              moves, it follows the wizard */}
          {guide && wizardStep === 'form' && (
            <QuestStrip
              label={`Open your stall · ${guide.count}`}
              text={guide.text}
              stamp="stall"
              className="mt-8 max-w-[768px]"
            />
          )}

          <CreateSection chainId={chain} />

          {/* the same registration the Studio path makes, sent from the browser. Both
              routes end at the same registry record and the same checks. */}
          <div id="register-here" className="mt-[30px] scroll-mt-4">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
              <Stack gap={20}>
                <SectionHead title="2. List your agent" note="ONE TRANSACTION" />
                <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
                  The same registration, without installing anything. You send one transaction from
                  your own wallet, and the registry records you as the owner. We then probe the
                  endpoint and decide whether the shelf carries it, the same as for a Studio
                  registration.
                </Txt>
                {chain === null ? (
                  <Txt size={13} lead={20} tone="steel" className="block">
                    Checking the network before the registration step.
                  </Txt>
                ) : (
                  <>
                    {guide && wizardStep !== 'form' && (
                      <QuestStrip
                        label={`Open your stall · ${guide.count}`}
                        text={guide.text}
                        done={wizardStep === 'listed'}
                        stamp="stall"
                        className="max-w-[768px]"
                      />
                    )}
                    <RegisterWizard chainId={chain} onStep={setWizardStep} />
                  </>
                )}
              </Stack>
              {chain !== null && (
                <Stack gap={20}>
                  <GasRequirement chainId={chain} />
                  <LoopCard />
                </Stack>
              )}
            </div>
          </div>
          <ChecklistSection />
          <LookupSection chainId={chain} onFound={setFoundTokenId} />
          <ReviewRequestSection key={foundTokenId ?? 'none'} defaultTokenId={foundTokenId ?? ''} />
        </>
      )}
    </div>
  )
}

// the wizard's own loop, drawn at rest: each line waits its turn and claims no
// outcome until the wizard running above fills the real ones in. carried on the
// quest card's indigo so the running loop below reads as its filled-in self
function LoopCard() {
  return (
    <Stack bg="indigo" radius={20} pad={[20, 22, 20, 22]} gap={12} className="border border-white/15">
      {/* the head is drawn in the on-indigo tones by hand: SectionHead's own tones
          are canvas-side and would invert on the indigo surface */}
      <Row justify="between" align="center" gap={12} className="flex-wrap">
        <Txt size={18} lead={27} weight="bold" tone="white">
          The verification loop
        </Txt>
        <Txt size={10} lead={12} weight="bold" upper tone="indigo-labels" mono>
          7 checks, in order
        </Txt>
      </Row>
      {LOOP_STEPS.map((title, i) => {
        const last = i === LOOP_STEPS.length - 1
        return (
          <Row key={title} gap={10} align="start">
            <Txt size={11} lead={18} mono tone="indigo-labels">{String(i + 1).padStart(2, '0')}</Txt>
            <Stack gap={6}>
              <Row gap={8} align="center">
                <Txt size={13} lead={18} tone="white">{title}</Txt>
                <Pill variant="off">Waiting</Pill>
              </Row>
              {last && (
                <Txt size={11} lead={16} tone="indigo-labels" className="block max-w-[440px]">
                  {LOOP_NOTE}
                </Txt>
              )}
            </Stack>
          </Row>
        )
      })}
    </Stack>
  )
}

// what the quest guide says at each point of the listing wizard
const LISTING_GUIDE: Record<WizardStep, { count: string; text: string }> = {
  form: {
    count: 'Registration 1 of 3',
    text: 'List one agent of your own. Build it with Agent Studio as shown below, or register an agent you already run with the form on this page.',
  },
  prepared: {
    count: 'Registration 2 of 3',
    text: 'Your registration is ready. Sign the transaction in your wallet: it registers the agent with you as its owner.',
  },
  signing: { count: 'Registration 2 of 3', text: 'Waiting for your wallet to sign the registration.' },
  confirming: { count: 'Registration 2 of 3', text: 'Waiting for the transaction to confirm on chain.' },
  pending: {
    count: 'Registration 3 of 3',
    text: 'The transaction is sent and still confirming. Check it again with the button in the wizard; it is not sent twice.',
  },
  listed: {
    count: 'Done',
    text: 'Your agent is registered. Your passport stamps this step once the agent is on the marketplace shelf.',
  },
  error: { count: 'Registration 2 of 3', text: 'The wizard says below what happened and what to do next.' },
}

// Matches GAS_FLOOR_WEI in src/app/api/tokens/mint/route.ts: the sponsored mint
// tops a wallet up to this amount, so one already at or above it needs no drip.
const GAS_FLOOR_WEI = 10n ** 15n

// Registration is the participant's own transaction, which is how the registry
// records them as owner. So the wallet, not the marketplace, pays the gas, and a
// fresh testnet wallet has none. This states the cost and the ways to cover it
// before the register button is reached.
function GasRequirement({ chainId }: { chainId: number }) {
  const [account, setAccount] = useState<string | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [reading, setReading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [gasTxHash, setGasTxHash] = useState<string | null>(null)
  const [gasNote, setGasNote] = useState<string | null>(null)
  const testnet = isTestnet(chainId)
  const symbol = testnet ? 'tBNB' : 'BNB'
  const holdsGas = balance !== null && balance >= GAS_FLOOR_WEI

  const refresh = useCallback(
    async (who: string | null) => {
      if (!who) {
        setBalance(null)
        return
      }
      setReading(true)
      try {
        setBalance(await readNativeBalance(who as `0x${string}`, chainId))
      } catch {
        setBalance(null)
      }
      setReading(false)
    },
    [chainId],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const active = await sessionAccount()
      if (cancelled) return
      setAccount(active)
      await refresh(active)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function connect() {
    setConnecting(true)
    setError(null)
    try {
      const who = await connectWallet()
      setAccount(who)
      await refresh(who)
    } catch (e) {
      setError((e as Error).message)
    }
    setConnecting(false)
  }

  // Signs the same sponsored-mint message the hire flow uses, so the visitor pays
  // no gas; the server submits it and tops the wallet up to the gas floor.
  async function getGas() {
    setError(null)
    setGasTxHash(null)
    setGasNote(null)
    setPhase('sending')
    try {
      const who = account ?? (await connectWallet())
      setAccount(who)
      const expires = Math.floor(Date.now() / 1000) + 15 * 60
      const nonce = `${expires}-${who.slice(2, 10).toLowerCase()}`
      const fields = {
        address: who.toLowerCase(),
        amount: MINT_PER_CLICK.toString(),
        nonce,
        expires,
      }
      const provider = await getProvider()
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [mintRequestMessage(fields), who],
      })) as string
      const res = await fetch('/api/tokens/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, signature }),
      })
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        gasTxHash?: string | null
        gasDrip?: { message?: string } | null
      } | null
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'The sponsored mint did not answer. Use the official faucet above.')
        setPhase('error')
        return
      }
      setGasTxHash(body.gasTxHash ?? null)
      setGasNote(body.gasDrip?.message ?? null)
      setPhase('sent')
      // the top-up is a broadcast, not a state change, so re-read it shortly after
      setTimeout(() => void refresh(who), 5000)
    } catch (e) {
      const err = e as Error & { code?: number }
      setError(
        err.code === 4001
          ? 'You cancelled the signature, so nothing was sent.'
          : 'The sponsored mint failed. Use the official faucet above.',
      )
      setPhase('error')
    }
  }

  return (
    <Stack surface gap={14} pad={[20, 22, 20, 22]}>
      <SectionHead title="Gas to list" note={chainLabel(chainId)} />
      <Txt size={12} lead={18} tone="steel" className="block">
        Registration is one transaction sent from your own wallet, which is how the
        registry records you as the owner. Nobody can send it for you, so your wallet
        pays a little {symbol} in gas.
      </Txt>

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <dt>
            <Label tone="labels">Your {symbol}</Label>
          </dt>
          <dd>
            <Txt size={11} lead={16} mono tone="steel">
              {!account
                ? 'no wallet connected'
                : reading
                  ? 'reading'
                  : balance === null
                    ? 'unavailable'
                    : `${formatNative(balance)} ${symbol}`}
            </Txt>
          </dd>
        </div>
        {account && (
          <div className="flex items-center gap-2">
            <dt>
              <Label tone="labels">Wallet</Label>
            </dt>
            <dd>
              <Txt size={11} lead={16} mono tone="steel">
                {shortAddress(account)}
              </Txt>
            </dd>
          </div>
        )}
      </dl>

      {!account && (
        <Btn kind="off" disabled={connecting} onClick={() => void connect()} className="w-full">
          {connecting ? 'Connecting…' : 'Connect wallet to check'}
        </Btn>
      )}

      {testnet ? (
        <>
          <Txt size={12} lead={18} tone="slate" className="block">
            Two ways: BNB&apos;s testnet faucet works for any wallet, or sign one free message
            below and we pay for the mint.
          </Txt>
          <Row gap={12} align="center" className="flex-wrap">
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-souk-hair bg-souk-surface1 px-5 hover:text-souk-ink"
            >
              <Txt size={14} lead={20} weight="semibold" tone="slate">BSC testnet faucet →</Txt>
            </a>
            {!holdsGas && (
              <Btn kind="primary" disabled={phase === 'sending'} onClick={() => void getGas()}>
                {phase === 'sending' ? (
                  'Sign the message in your wallet'
                ) : (
                  <>Top up {symbol} for gas</>
                )}
              </Btn>
            )}
          </Row>
          <Txt size={12} lead={18} tone="muted" className="block">
            The sponsored mint grants 10 test sUSD, and it tops your {symbol} up to
            0.001 {symbol} for gas when you hold less than that. It sends only the
            shortfall, so a wallet holding dust is still covered. The mint itself
            costs you no gas.
          </Txt>
          {holdsGas && balance !== null && (
            <Txt size={12} lead={18} tone="ink" className="block">
              This wallet already holds {formatNative(balance)} {symbol}, which
              covers the gas for registration, so no top-up will be sent.
            </Txt>
          )}
          {phase === 'error' && error && (
            <p role="alert">
              <Txt size={12} lead={18} tone="peach" className="block">
                {error}
              </Txt>
            </p>
          )}
          {phase === 'sent' && (
            <Txt size={12} lead={18} tone="ink" className="block">
              {gasNote ?? 'Minted, but no gas top-up was reported.'}
              {gasTxHash && (
                <>
                  {' '}
                  <a
                    href={`${explorerTxBase(chainId)}/tx/${gasTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-souk-hair underline-offset-2 hover:text-souk-data"
                  >
                    View the top-up
                  </a>
                  .
                </>
              )}
            </Txt>
          )}
        </>
      ) : (
        <Txt size={12} lead={18} tone="slate" className="block">
          Keep a little {symbol} in the wallet before you register. There is no
          sponsored top-up on mainnet.
        </Txt>
      )}
    </Stack>
  )
}

// the code block under a step: surface two at radius 8, mono lines
function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <Stack
      gap={4}
      pad={[14, 16, 14, 16]}
      radius={8}
      className="border border-souk-hair bg-souk-surface2"
    >
      {lines.map((line) => (
        <Txt key={line} size={12} lead={18} mono tone="ink">
          {line}
        </Txt>
      ))}
    </Stack>
  )
}

function CreateSection({ chainId }: { chainId: number | null }) {
  // the addresses we publish are the ones for the chain this deployment serves
  const chainName = chainId === null ? null : chainId === 97 ? 'BSC testnet' : 'BSC'
  const registryAddress = chainId === null ? null : registryFor(chainId) ?? REGISTRY_BY_CHAIN[56]
  return (
    <Stack gap={20} className="mt-[30px]">
      {/* the design's head row with the studio link in the note slot */}
      <Row
        justify="between"
        align="center"
        gap={9}
        pad={[0, 0, 9, 0]}
        className="flex-wrap border-b border-b-souk-hair"
      >
        <Txt size={18} lead={27} weight="bold" tone="ink">
          1. Create and register with BNB Agent Studio
        </Txt>
        <a
          href="https://www.bnbchain.org/en/bnb-agent-studio"
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] uppercase leading-[14px] text-souk-labels hover:text-souk-ink"
        >
          BNB Agent Studio →
        </a>
      </Row>

      <ol className="grid items-stretch gap-5 md:grid-cols-2">
        <li className="flex h-full">
          <Stack surface gap={10} pad={[20, 22, 18, 22]} className="w-full">
            <Txt size={10} lead={14} weight="bold" upper tone="muted">Step 1</Txt>
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Install the CLI</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              One npm install brings the CLI and the runtime. One more command sets up your editor,
              Cursor or Claude Code. The new wallet is funded with test BNB and test stablecoin for
              you.
            </Txt>
            <CodeBlock lines={['npm install -g @bnbagent/studio-cli', 'bag skills install']} />
          </Stack>
        </li>
        <li className="flex h-full">
          <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full">
            <Txt size={10} lead={14} weight="bold" upper tone="muted">Step 2</Txt>
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Describe your agent</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              In Cursor or Claude Code, say what the agent does and ask Studio to deploy it. Studio
              scaffolds the agent, deploys it, registers the ERC-8004 identity on{' '}
              {chainName ?? 'the target network'} (
              {chainId !== null && registryAddress ? (
                <a
                  href={explorerAddressUrl(chainId, registryAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-[11px] text-souk-ink hover:text-souk-data"
                >
                  registry {registryAddress}
                </a>
              ) : (
                'registry pending'
              )}
              ), binds the agent wallet, and registers the ERC-8183 task interface. x402 payment
              comes configured by default.
            </Txt>
          </Stack>
        </li>
        <li className="flex h-full">
          <PromptGeneratorCard chainId={chainId} />
        </li>
        <li className="flex h-full">
          <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full">
            <Txt size={10} lead={14} weight="bold" upper tone="muted">Step 4</Txt>
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Note your task interface</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              Your agent exposes an MCP server or an A2A endpoint, reachable over HTTPS. That is
              what the verifier calls, so make sure it is up before you list. For version-specific
              commands, follow{' '}
              <a
                href="https://docs.bnbchain.org/developer-kit/bnbchain-studio/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-souk-hair underline-offset-4 hover:text-souk-ink"
              >
                <Txt size={13} lead={20} tone="ink">BNB&apos;s studio docs</Txt>
              </a>
              .
            </Txt>
            <Row>
              <Btn
                kind="off"
                onClick={() =>
                  document.getElementById('register-here')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Continue to listing
              </Btn>
            </Row>
          </Stack>
        </li>
      </ol>

      <Txt size={13} lead={20} tone="steel" className="block max-w-[1180px]">
        Studio builds and deploys the agent. Agent Souk is where buyers find it and where we check it.
      </Txt>
    </Stack>
  )
}

// Takes no chainId. It never used one, and the prop was threaded through from a parent
// that had it only to hand it down.
function ChecklistSection() {
  const [open, setOpen] = useState(false)
  return (
    <Stack gap={20} className="mt-[30px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-b-souk-hair pb-3 text-left hover:text-souk-slate"
      >
        <Txt size={22} lead={30} weight="bold" tone="ink">What the verifier looks for</Txt>
        <Txt size={20} lead={24} weight="bold" tone="steel" aria-hidden="true">
          {open ? '−' : '+'}
        </Txt>
      </button>
      {open && (
        <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
          Every badge on this site comes from a real check against the real endpoint.
        </Txt>
      )}
      {open && (
        <div className="grid gap-5 md:grid-cols-2">
          {checklist.map((item, i) => (
            <Stack key={item.title} surface gap={10} pad={[20, 22, 20, 22]}>
              <Txt size={10} lead={14} weight="bold" upper tone="labels">
                Check {i + 1} of 6
              </Txt>
              <Txt size={17} lead={24} weight="bold" tone="ink" className="block">
                {item.title}
              </Txt>
              <Txt size={13} lead={20} tone="slate" className="block">
                {item.why}
              </Txt>
            </Stack>
          ))}
        </div>
      )}
      <Txt size={13} lead={20} tone="steel" className="block max-w-[1180px]">
        Meet the checklist and the badge speaks for you: delivered, graded, public. It does not
        promise placement or traffic.
      </Txt>
    </Stack>
  )
}

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; agent: AgentDetail }
  | { phase: 'missing' }
  | { phase: 'invalid' }
  | { phase: 'error' }

// pure client-side string building from the seller's inputs; no backend, no AI
function buildDescription(
  def: CategoryDef,
  name: string,
  goal: string,
): string {
  const clean = goal.trim().replace(/\s+/g, ' ')
  const named = name.trim() ? `${name.trim()} is` : 'This agent is'
  let text = `${named} a ${def.label.toLowerCase()} agent for BNB Chain. ${def.blurb}`
  if (clean) text += ` What it should achieve: ${clean}.`
  return text
}

function buildPrompt(
  category: CategoryKey,
  name: string,
  goal: string,
  chainId: number | null,
): string {
  const def = categoryDef(category)
  const description = buildDescription(def, name, goal)
  const label = name.trim() || `a ${def.label.toLowerCase()} agent`
  // derived, not pasted: the registry must be the one this deployment indexes
  const networkName = chainId === null ? 'the target network' : chainLabel(chainId)
  const registryAddress = chainId === null ? null : registryFor(chainId) ?? REGISTRY_BY_CHAIN[56]
  const registryNote = registryAddress
    ? `(registry ${registryAddress}${chainId === 97 ? ', chain 97' : ''})`
    : '(registry pending)'
  return [
    'Install the bnb CLI, describe this agent to Studio, and ship it end to end. Studio scaffolds the agent, deploys it, and registers the ERC-8004 identity on BSC. The agent to build is:',
    '',
    `${label} (${def.label}).`,
    '',
    'Registration description to use, so search and buyers read an honest summary:',
    description,
    '',
    'Acceptance criteria. The work is done only when all of these hold:',
    '1. The agent exposes a reachable MCP or A2A endpoint over HTTPS.',
    '2. x402Support is set in the registration.',
    `3. The registration description names the category honestly: ${def.label.toLowerCase()}, in its own words.`,
    '4. A performance or reporting tool is exposed, for example get_performance, that returns live numbers.',
    '5. Exactly one registration is made, not a numbered series of duplicates.',
    '',
    // The registry address must be the one this deployment indexes (chain 97), and the origin
    // the judged domain; a mainnet registry or wrong origin makes listing silently fail.
    `When done, the agent must be registered on ${networkName} ERC-8004 ${registryNote} and appear when searched on agentsouk.xyz.`,
  ].join('\n')
}

// step 3's own card: three questions asked in a dialog, the checklist above reused
// as the prompt's acceptance criteria
function PromptGeneratorCard({ chainId }: { chainId: number | null }) {
  const [category, setCategory] = useState<CategoryKey>('rebalancing')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  function generate() {
    setPrompt(buildPrompt(category, name, goal, chainId))
    setCopied(false)
  }

  async function copy() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full">
      <Txt size={10} lead={14} weight="bold" upper tone="muted">Step 3</Txt>
      <Txt size={18} lead={26} weight="bold" tone="ink" className="block">
        Generate your Agent Studio prompt
      </Txt>
      <Txt size={13} lead={20} tone="slate" className="block">
        Answer three questions and we write a prompt for your coding agent, with the checklist
        above as its acceptance criteria.
      </Txt>
      <Row>
        <Btn kind="off" onClick={() => setOpen(true)}>Generate prompt</Btn>
      </Row>

      {open && (
        <Dialog title="Generate your Agent Studio prompt" onClose={() => setOpen(false)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="wizard-category">
                <Label tone="labels">Category</Label>
              </label>
              <div className="mt-2">
                <select
                  id="wizard-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryKey)}
                  className={inputClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="wizard-name">
                <Label tone="labels">Agent name (one line)</Label>
              </label>
              <div className="mt-2">
                <input
                  id="wizard-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="BNB Lending Guardian"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className={labelClass} htmlFor="wizard-goal">
              <Label tone="labels">What the agent should achieve</Label>
            </label>
            <div className="mt-2">
              <textarea
                id="wizard-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                placeholder="Watch borrowing positions on Venus and protect them before liquidation hits."
                className={areaClass}
              />
            </div>
          </div>

          <Row className="mt-6">
            <Btn kind="primary" onClick={generate}>Generate prompt</Btn>
          </Row>

          {prompt && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <Label tone="labels">Your prompt</Label>
                <Btn kind="off" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn>
              </div>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-[8px] border border-souk-hair bg-souk-surface2 p-4 font-mono text-[11px] leading-[18px] text-souk-ink">
                {prompt}
              </pre>
            </div>
          )}
        </Dialog>
      )}
    </Stack>
  )
}

function LookupSection({
  chainId,
  onFound,
}: {
  chainId: number | null
  onFound: (tokenId: string) => void
}) {
  const [input, setInput] = useState('')
  const [state, setState] = useState<LookupState>({ phase: 'idle' })

  async function lookup() {
    const tokenId = parseTokenId(input)
    if (!tokenId) {
      setState({ phase: 'invalid' })
      return
    }
    // the chain the site is actually serving, from the shared store, never a
    // compiled-in 56 that sent every lookup to the wrong network
    if (chainId === null) return
    setState({ phase: 'loading' })
    try {
      const agent = await getAgentDetail(String(chainId), tokenId)
      if (agent) {
        onFound(tokenId)
        setState({ phase: 'found', agent })
      } else {
        setState({ phase: 'missing' })
      }
    } catch {
      setState({ phase: 'error' })
    }
  }

  return (
    <Stack gap={20} className="mt-[30px]">
      <SectionHead title="3. Instant lookup" note="WE CHECK THE LIVE REGISTRY" />
      <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
        Paste your token id, or your whole registry agent URL. We check the live registry.
      </Txt>

      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void lookup()
        }}
      >
        <div className="w-full max-w-[448px] min-w-[240px]">
          <label className={labelClass} htmlFor="token-lookup">
            <Label tone="labels">Token id or agent URL</Label>
          </label>
          <div className="mt-2">
            <input
              id="token-lookup"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="45381, 56:45381, or your agent URL"
              className={inputClass}
            />
          </div>
        </div>
        <Btn kind="primary" type="submit" disabled={state.phase === 'loading' || chainId === null}>
          {state.phase === 'loading'
            ? 'Checking…'
            : chainId === null
              ? 'Checking the network…'
              : 'Look up'}
        </Btn>
      </form>

      <div>
        {state.phase === 'invalid' && (
          <NoteBox title="No token id found in that." className="max-w-[768px]">
            <Txt size={12} lead={18} tone="steel" className="block">
              Paste a bare number like 45381, a pair like 56:45381, or your agent URL.
            </Txt>
          </NoteBox>
        )}
        {state.phase === 'error' && (
          <NoteBox title="The registry check failed." className="max-w-[768px]">
            <Txt size={12} lead={18} tone="steel" className="block">
              Try again in a moment.
            </Txt>
          </NoteBox>
        )}
        {state.phase === 'missing' && (
          <NoteBox title="Not in the registry yet." className="max-w-[768px]">
            <Txt size={12} lead={18} tone="steel" className="block">
              No live listing for that token id. Finish the Agent Studio registration in step 1, or
              check the number: it is the token your registration minted, also shown by the
              registry index.
            </Txt>
          </NoteBox>
        )}
        {state.phase === 'found' && <FoundAgent agent={state.agent} />}
      </div>
    </Stack>
  )
}

function ReviewRequestSection({ defaultTokenId }: { defaultTokenId: string }) {
  const [tokenId, setTokenId] = useState(defaultTokenId)
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPhase('sending')
    try {
      const res = await fetch('/api/listings/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenId, contact, note }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'The request failed. Try again in a moment.')
        setPhase('error')
        return
      }
      setPhase('sent')
    } catch {
      setError('The request failed. Try again in a moment.')
      setPhase('error')
    }
  }

  return (
    <Stack gap={20} className="mt-[30px]">
      <SectionHead title="4. Request a listing review" note="A PERSON READS EVERY REQUEST" />
      <Txt size={15} lead={23} tone="slate" className="block max-w-[1180px]">
        Met the checklist and still not listed? Send the token id and how to reach you. A person
        reads every request.
      </Txt>

      {phase === 'sent' ? (
        <NoteBox title="Request received." className="max-w-[768px]">
          <Txt size={12} lead={18} tone="steel" className="block">
            We read every one and reply to the contact you left.
          </Txt>
        </NoteBox>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex w-full max-w-[626px] flex-col gap-4">
          <div>
            <label className={labelClass} htmlFor="review-token-id">
              <Label tone="labels">BSC token id</Label>
            </label>
            <div className="mt-2">
              <input
                id="review-token-id"
                type="text"
                inputMode="numeric"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                placeholder="45381"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="review-contact">
              <Label tone="labels">Contact (email or handle)</Label>
            </label>
            <div className="mt-2">
              <input
                id="review-contact"
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="you@example.com or @handle"
                autoComplete="email"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="review-note">
              <Label tone="labels">
                Note <span className="normal-case">(optional)</span>
              </Label>
            </label>
            <div className="mt-2">
              <textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="What you fixed since the last check."
                className={areaClass}
              />
            </div>
          </div>
          {error && (
            <p role="alert">
              <Txt size={12} lead={18} tone="peach" className="block">
                {error}
              </Txt>
            </p>
          )}
          <Row>
            <Btn kind="primary" type="submit" disabled={phase === 'sending'}>
              {phase === 'sending' ? 'Sending…' : 'Request review'}
            </Btn>
          </Row>
        </form>
      )}
    </Stack>
  )
}

// what a lookup hands back: the listing, its tags, and the one verdict the
// check record actually carries for this token
function FoundAgent({ agent }: { agent: AgentDetail }) {
  const classification = classifyAgent(
    `${agent.name} ${agent.description ?? ''}`,
  )
  const category =
    classification.category === 'general'
      ? null
      : categoryDef(classification.category).label
  const verdict = verdictFor(agent.chain_id, agent.verification)

  return (
    <Stack
      bg="indigo"
      gap={12}
      pad={[20, 22, 20, 22]}
      radius={20}
      className="border-souk-data/50 overflow-hidden"
    >
      <Row gap={9} align="center">
        <Dot tone="good" size={9} />
        <Txt size={14} lead={20} weight="semibold" tone="ink">
          Listed. Your agent is on the market now.
        </Txt>
      </Row>
      <Txt size={24} lead={32} weight="bold" tone="ink" className="block">
        {agent.name}
      </Txt>
      <Row gap={8} align="center" className="flex-wrap">
        {category && <Pill variant="off">{category}</Pill>}
        {agent.x402_supported && (
          <span title="Takes payment per call over x402">
            <Pill variant="off">x402</Pill>
          </span>
        )}
        {agent.pcs && (
          <span title="Says it works with PancakeSwap">
            <Pill variant="off">PancakeSwap</Pill>
          </span>
        )}
        <Txt size={11} lead={16} mono tone="labels">
          BNB {agent.chain_id} - #{agent.token_id}
        </Txt>
      </Row>
      <div title={verdict.explain} className="flex flex-wrap items-center gap-2">
        <Dot tone={VERDICT_DOTTONE[verdict.tone]} size={8} />
        <Txt size={13} lead={20} weight="semibold" tone="ink">{verdict.label}</Txt>
        <Txt size={13} lead={20} tone="steel"> - {verdict.explain}</Txt>
      </div>
      {agent.description && (
        <Txt size={13} lead={20} tone="slate" className="block max-w-[1180px]">
          {agent.description}
        </Txt>
      )}
      <Link to={`/agents/${agent.chain_id}/${agent.token_id}`} className="w-fit hover:text-souk-ink">
        <Txt size={10} lead={14} weight="bold" upper tone="data">View your listing -&gt;</Txt>
      </Link>
    </Stack>
  )
}
