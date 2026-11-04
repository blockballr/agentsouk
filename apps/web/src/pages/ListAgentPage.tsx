import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { VerdictTone } from '../lib/verdict'
import { verdictFor } from '../lib/verdict'
import type { AgentDetail } from '../core/types'
import {
  categoryDef,
  classifyAgent,
  mintRequestMessage,
  shortAddress,
} from '@agora/core'
import { getProvider } from '../lib/wallet'
import { useConnectedAccount } from '../lib/use-connected-account'
import { connectWallet } from '../lib/wallet-session'
import { useTargetChain } from '../lib/target-chain'
import { FAUCET_URL, MINT_PER_CLICK, isTestnet, readNativeBalance } from '../lib/mint'
import {
  chainLabel,
  explorerTxBase,
} from '../lib/contracts'
import { getAgentDetail } from '../lib/api'
import { RegisterWizard, initialChecks, type WizardStep } from '../components/RegisterWizard'

import { VerificationLoop, type CheckLine, type GasReadiness } from '../components/VerificationLoop'
import { QuestStrip } from '../components/QuestStrip'
import { Turnstile } from '../components/Turnstile'
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

// the dot beside a verdict, mapped from the shared verdict tone
const VERDICT_DOTTONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

import { areaClass, inputClass, labelClass } from '../lib/form-classes'

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
  // The chain comes from the shared store, which starts unknown and learns the
  // deployment's chain once from the server, so a direct load cannot paint a
  // compiled-in mainnet default and hand a testnet participant wrong advice.
  const target = useTargetChain()
  const chain = target?.chainId ?? null
  // a passport link opens the page with the guide for its listing step
  const [searchParams] = useSearchParams()
  const questing = searchParams.get('quest') === 'stall'
  const [wizardStep, setWizardStep] = useState<WizardStep>('form')
  // the loop the wizard runs, carried up so the side rail can draw it as the design does
  const [loopChecks, setLoopChecks] = useState<CheckLine[] | null>(() => initialChecks('call'))

  // Where the eye should be once the form is sent: the verifier card is the only
  // thing that answers after the continue, and on a wide screen it sits in the
  // side rail where a click at the bottom of the form leaves it out of view.
  const [gasState, setGasState] = useState<GasReadiness | null>(null)
  const verifierFocused = useRef(false)
  useEffect(() => {
    if (wizardStep === 'form') {
      verifierFocused.current = false
      return
    }
    if (verifierFocused.current) return
    const card = document.getElementById('verifier-check')
    if (!card) return
    verifierFocused.current = true
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    card.focus({ preventScroll: true })
  }, [wizardStep])

  // the listing flow is several screens long, so the page opens on the pitch and
  // one action rather than on the wizard
  const [started, setStarted] = useState(true)
  const guide = questing ? LISTING_GUIDE[wizardStep] : null

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-[240px] pt-11 text-souk-ink xl:pb-28">
      {/* hero - sell on agent souk: kicker carries the intent, the campaign card
          leads, and the actions follow beneath it */}
      <Stack gap={12} className="w-full">
        <Txt size={11} lead={16} mono upper tone="data">
          Sell on Agent Souk
        </Txt>
        {!started ? null : (
          <>
            {/* a listing counts for the campaign only once the wallet and the agent are entered with BNB.
                the quest card's own indigo surface: white-family copy and white-alpha lines, so it
                reads the same on paper */}
            <Stack bg="indigo" pad={[14, 22, 14, 22]} gap={4} className="mt-2 max-w-[768px] border border-white/15">
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
          </>
        )}
        <Row gap={10} align="center" className="flex-wrap">
          {!started ? (
            <Btn kind="primary" onClick={() => setStarted(true)}>
              Get Listed
            </Btn>
          ) : (
            <>
              <Btn
                kind="primary"
                onClick={() =>
                  document.getElementById('register-here')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Start listing
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
      {/* while the form is untouched the guide sits where the visitor lands; once the wizard
          moves, it follows the wizard */}
      {!started ? null : (
        <>
          {guide && wizardStep === 'form' && (
            <QuestStrip
              label={`Open your stall · ${guide.count}`}
              text={guide.text}
              stamp="stall"
              className="mt-8 max-w-[768px]"
            />
          )}

          {/* the same registration the Studio path makes, sent from the browser. Both
              routes end at the same registry record and the same checks. */}
          <div id="register-here" className="mt-[30px] scroll-mt-4">
            <SectionHead title="1. List your agent" note="ONE TRANSACTION" />
            <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
              <Stack gap={20}>
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
                    <RegisterWizard chainId={chain} onStep={setWizardStep} onChecks={setLoopChecks} />
                  </>
                )}
              </Stack>
              <Stack gap={20}>
                {chain !== null && <GasRequirement chainId={chain} onState={setGasState} />}
                {loopChecks && <VerificationLoop checks={loopChecks} gas={gasState} />}
              </Stack>
            </div>
          </div>
          <LookupSection chainId={chain} onFound={setFoundTokenId} />
          <ReviewRequestSection key={foundTokenId ?? 'none'} defaultTokenId={foundTokenId ?? ''} />
        </>
      )}
      <Turnstile onToken={() => {}} />
    </div>
  )
}
const LISTING_GUIDE: Record<WizardStep, { count: string; text: string }> = {
  form: {
    count: 'Registration 1 of 3',
    text: 'List one agent of your own. If you already run an agent, paste its endpoint in the form below. If you need to build one, the BNB Agent Studio guide sits under the form.',
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
function GasRequirement({ chainId, onState }: { chainId: number; onState?: (gas: GasReadiness | null) => void }) {
  const account = useConnectedAccount()
  const [balance, setBalance] = useState<bigint | null>(null)
  const [reading, setReading] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [gasTxHash, setGasTxHash] = useState<string | null>(null)
  const [gasNote, setGasNote] = useState<string | null>(null)
  const testnet = isTestnet(chainId)
  const symbol = testnet ? 'tBNB' : 'BNB'
  const holdsGas = balance !== null && balance >= GAS_FLOOR_WEI
  // the rail fills to the one registration's cost, so the bar answers "can I pay
  // for this yet" rather than reporting a balance the lister has to judge
  const pct =
    balance === null
      ? 0
      : balance >= GAS_FLOOR_WEI
        ? 100
        : Number((balance * 100n) / GAS_FLOOR_WEI)

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

  // A balance read needs no signature: the address the page is acting for is
  // enough, and connecting a wallet is the rail's job.
  useEffect(() => {
    void refresh(account)
  }, [account, refresh])

  // The verifier card carries the readiness next to the checks it is about to
  // run, so the wallet's ability to pay for the one transaction is never the
  // thing a lister discovers last.
  useEffect(() => {
    if (!account) {
      onState?.(null)
      return
    }
    onState?.({
      holds: balance !== null && balance >= GAS_FLOOR_WEI,
      symbol,
      balance: balance === null ? null : formatNative(balance),
    })
  }, [account, balance, onState, symbol])

  // Signs the same sponsored-mint message the hire flow uses, so the visitor pays
  // no gas; the server submits it and tops the wallet up to the gas floor.
  async function getGas() {
    setError(null)
    setGasTxHash(null)
    setGasNote(null)
    setPhase('sending')
    try {
      const who = account ?? (await connectWallet())
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
    <Stack
      surface
      gap={10}
      pad={[14, 16, 14, 16]}
      style={{
        backgroundImage:
          'repeating-linear-gradient(135deg, rgba(17,26,74,0.05) 0 1px, transparent 1px 9px)',
      }}
    >
      <Row justify="between" align="center" gap={8}>
        <Txt size={10} lead={14} weight="bold" upper tone="muted">
          Gas to list
        </Txt>
        <Txt size={10} lead={14} mono upper tone="labels">
          {chainLabel(chainId)}
        </Txt>
      </Row>

      <Row justify="between" align="center" gap={8}>
        <Txt size={12} lead={18} mono tone="ink">
          {!account
            ? 'No wallet connected'
            : reading
              ? 'Reading'
              : balance === null
                ? 'Unavailable'
                : `${formatNative(balance)} ${symbol}`}
        </Txt>
        {account && (
          <Txt size={10} lead={14} mono tone="steel">
            {shortAddress(account)}
          </Txt>
        )}
      </Row>

      <div className="h-[6px] w-full overflow-hidden rounded-[3px] bg-souk-hair/50">
        <div
          className={`h-full rounded-[3px] transition-[width] duration-500 ease-out motion-reduce:transition-none ${
            holdsGas ? 'bg-souk-data' : 'bg-souk-peach'
          }`}
          style={{ width: `${pct}%`, minWidth: 6 }}
        />
      </div>

      {account && !holdsGas && (
        <Txt size={11} lead={16} tone="steel" className="block">
          {`${formatNative(GAS_FLOOR_WEI)} ${symbol} covers one registration.`}
        </Txt>
      )}

      {testnet ? (
        <>
          <Row gap={8} align="center" className="flex-wrap">
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-souk-hair bg-souk-surface1 px-3 hover:text-souk-ink"
            >
              <Txt size={12} lead={18} weight="semibold" tone="slate">
                Faucet
              </Txt>
            </a>
            {account && !holdsGas && (
              <Btn kind="primary" disabled={phase === 'sending'} onClick={() => void getGas()}>
                {phase === 'sending' ? 'Sign in wallet' : `Top up ${symbol}`}
              </Btn>
            )}
<button
              type="button"
              onClick={() => window.dispatchEvent(new Event('agentsouk:open-swap'))}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-souk-hair bg-souk-surface1 px-4 hover:text-souk-ink"
            >
              <Txt size={12} lead={18} weight="semibold" tone="slate">
                Swap
              </Txt>
            </button>
          </Row>
          {phase === 'error' && error && (
            <p role="alert">
              <Txt size={11} lead={16} tone="peach" className="block">
                {error}
              </Txt>
            </p>
          )}
          {phase === 'sent' && (
            <Txt size={11} lead={16} tone="ink" className="block">
              {gasNote ?? 'Mint sent.'}
              {gasTxHash && (
                <>
                  {' '}
                  <a
                    href={`${explorerTxBase(chainId)}/tx/${gasTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-souk-hair underline-offset-2 hover:text-souk-data"
                  >
                    View
                  </a>
                </>
              )}
            </Txt>
          )}
        </>
      ) : (
        account &&
        !holdsGas && (
          <Row gap={8} align="center" className="flex-wrap">
            <a
              href="https://www.binance.com/en/buy-BNB"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 w-fit items-center justify-center rounded-[8px] bg-souk-data px-4"
            >
              <Txt size={12} lead={18} weight="semibold" tone="canvas">
                Get BNB
              </Txt>
            </a>
<button
              type="button"
              onClick={() => window.dispatchEvent(new Event('agentsouk:open-swap'))}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-souk-hair bg-souk-surface1 px-4 hover:text-souk-ink"
            >
              <Txt size={12} lead={18} weight="semibold" tone="slate">
                Swap
              </Txt>
            </button>
          </Row>
        )
      )}
    </Stack>
  )
}

// the code block under a step: surface two at radius 8, mono lines


type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; agent: AgentDetail }
  | { phase: 'missing' }
  | { phase: 'invalid' }
  | { phase: 'error' }

// pure client-side string building from the seller's inputs; no backend, no AI
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
  const [email, setEmail] = useState('')
  const [telegram, setTelegram] = useState('')
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
        body: JSON.stringify({ tokenId, email, telegram, note }),
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
        Met the checklist and still not listed? Send the token id and your Telegram handle. A
        person reads every request.
      </Txt>

      {phase === 'sent' ? (
        <NoteBox title="Request received." className="max-w-[768px]">
          <Txt size={12} lead={18} tone="steel" className="block">
            We read every one and reply on Telegram.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="review-telegram">
                <Label tone="labels">Telegram handle</Label>
              </label>
              <div className="mt-2">
                <input
                  id="review-telegram"
                  type="text"
                  required
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="@yourhandle"
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="review-email">
                <Label tone="labels">
                  Email <span className="normal-case">(optional)</span>
                </Label>
              </label>
              <div className="mt-2">
                <input
                  id="review-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className={inputClass}
                />
              </div>
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
        <Txt size={14} lead={20} weight="semibold" tone="white">
          Listed. Your agent is on the market now.
        </Txt>
      </Row>
      <Txt size={24} lead={32} weight="bold" tone="white" className="block">
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
