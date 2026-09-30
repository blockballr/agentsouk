import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tag } from '../components/Tag'
import { VERDICT_DOT, verdictFor } from '../lib/verdict'
import type { AgentDetail, CategoryDef, CategoryKey } from '@agora/core'
import {
  CATEGORIES,
  categoryDef,
  classifyAgent,
  mintRequestMessage,
  shortAddress,
} from '@agora/core'
import { connectWallet, getActiveAccount, getProvider } from '../lib/wallet'
import { useTargetChain } from '../lib/target-chain'
import { FAUCET_URL, MINT_PER_CLICK, isTestnet, readNativeBalance } from '../lib/mint'
import {
  chainLabel,
  explorerAddressUrl,
  explorerTxBase,
  REGISTRY_BY_CHAIN,
  registryFor,
  SETTLEMENT_ASSET_BY_CHAIN,
  settlementAssetFor,
} from '../lib/contracts'
import { getAgentDetail } from '../lib/api'
import { RegisterWizard } from '../components/RegisterWizard'

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
  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">List your agent</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Built and registered.
        <br />
        Now get hired.
      </h1>
      <p className="mt-8 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
        Anyone can list, and our checks decide what buyers see. You build the agent in your own tools, BNB Agent Studio registers it, and Agent Souk is where it gets checked and sold. Three steps: build it, meet the checklist, confirm it is on the market.
      </p>
      {/* on a phone the wizard sits several screens down, so the page opens with a way to it */}
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => document.getElementById('register-here')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="micro min-h-11 rounded-[5px] bg-highlighter-green px-5 text-on-highlighter transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Register an agent
        </button>
        <button
          type="button"
          onClick={() => document.getElementById('token-lookup')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          className="micro min-h-11 rounded-[5px] border hairline border-slate-verdant/50 px-5 text-press-black transition hover:border-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Already registered? Look it up
        </button>
      </div>

      <CreateSection chainId={chain} />
      {/* register straight from here, for a participant who would rather not
          install the CLI. Sits after the Studio path because both are valid and
          the Studio route is the one the brief describes. */}
      <div id="register-here" className="mt-16 scroll-mt-4">
        <div className="border-t hairline border-slate-verdant/40 pt-8">
          <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
            Or register from here
          </h2>
          <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
            The same registration without Studio&apos;s CLI. You send one transaction from your own wallet,
            and the registry records you as the owner.
          </p>
          {chain === null ? (
            <p className="mt-8 text-sm leading-relaxed text-newsprint-gray">
              Checking the network before the registration step.
            </p>
          ) : (
            <>
              <GasRequirement chainId={chain} />
              <div className="mt-8">
                <RegisterWizard chainId={chain} />
              </div>
            </>
          )}
        </div>
      </div>
      <ChecklistSection chainId={chain} />
      <LookupSection chainId={chain} onFound={setFoundTokenId} />
      <ReviewRequestSection key={foundTokenId ?? 'none'} defaultTokenId={foundTokenId ?? ''} />
    </section>
  )
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
      const active = await getActiveAccount()
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
    <div className="mt-8 rounded-[14px] border hairline border-highlighter-green/50 bg-highlighter-green/5 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-xl font-medium">Gas to register</h3>
        <span className="micro text-newsprint-gray">{chainLabel(chainId)}</span>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Registration is one transaction sent from your own wallet, which is how the
        registry records you as the owner. Nobody can send it for you, so your wallet
        pays a little {symbol} in gas. A fresh testnet wallet starts with none.
      </p>

      <dl className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <dt className="micro text-newsprint-gray">
            Your <span className="normal-case">{symbol}</span>
          </dt>
          <dd className="font-mono text-press-black">
            {!account
              ? 'no wallet connected'
              : reading
                ? 'reading'
                : balance === null
                  ? 'unavailable'
                  : `${formatNative(balance)} ${symbol}`}
          </dd>
        </div>
        {account && (
          <div className="flex items-center gap-2">
            <dt className="micro text-newsprint-gray">Wallet</dt>
            <dd className="font-mono text-[11px] text-newsprint-gray">{shortAddress(account)}</dd>
          </div>
        )}
      </dl>

      {!account && (
        <button
          type="button"
          disabled={connecting}
          onClick={() => void connect()}
          className="micro mt-4 rounded-[5px] border hairline border-slate-verdant/50 px-5 py-2.5 text-press-black transition hover:bg-bone-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          {connecting ? 'Connecting…' : 'Connect wallet to check'}
        </button>
      )}

      {testnet ? (
        <>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
            Two ways: BNB&apos;s testnet faucet works for any wallet, or sign one free message below and we pay for the mint.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="micro rounded-[5px] border hairline border-slate-verdant/50 px-5 py-2.5 text-press-black transition hover:bg-bone-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
            >
              BSC testnet faucet →
            </a>
            {!holdsGas && (
              <button
                type="button"
                disabled={phase === 'sending'}
                onClick={() => void getGas()}
                className="micro rounded-[5px] bg-highlighter-green px-5 py-2.5 text-on-highlighter shadow-lg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                {phase === 'sending' ? (
                  'Sign the message in your wallet'
                ) : (
                  <>
                    Top up <span className="normal-case">{symbol}</span> for gas
                  </>
                )}
              </button>
            )}
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-newsprint-gray">
            The sponsored mint grants 10 test sUSD, and it tops your {symbol} up to
            0.001 {symbol} for gas when you hold less than that. It sends only the
            shortfall, so a wallet holding dust is still covered. The mint itself
            costs you no gas.
          </p>
          {holdsGas && balance !== null && (
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-press-black">
              This wallet already holds {formatNative(balance)} {symbol}, which
              covers the gas for registration, so no top-up will be sent.
            </p>
          )}
          {phase === 'error' && error && (
            <p role="alert" className="mt-3 text-sm leading-relaxed text-press-black">
              {error}
            </p>
          )}
          {phase === 'sent' && (
            <p className="mt-3 text-sm leading-relaxed text-press-black">
              {gasNote ?? 'Minted, but no gas top-up was reported.'}
              {gasTxHash && (
                <>
                  {' '}
                  <a
                    href={`${explorerTxBase(chainId)}/tx/${gasTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-press-black/30 underline-offset-2 hover:text-highlighter-green"
                  >
                    View the top-up
                  </a>
                  .
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
          Keep a little {symbol} in the wallet before you register. There is no
          sponsored top-up on mainnet.
        </p>
      )}
    </div>
  )
}

function CreateSection({ chainId }: { chainId: number | null }) {
  // the addresses we publish are the ones for the chain this deployment serves
  const chainName = chainId === null ? null : chainId === 97 ? 'BSC testnet' : 'BSC'
  const registryAddress = chainId === null ? null : registryFor(chainId) ?? REGISTRY_BY_CHAIN[56]
  const settlementAsset = chainId === null ? null : settlementAssetFor(chainId) ?? SETTLEMENT_ASSET_BY_CHAIN[56]
  return (
    <div className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-t hairline border-slate-verdant/40 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          1. Create and register with BNB Agent Studio
        </h2>
        <a
          href="https://www.bnbchain.org/en/bnb-agent-studio"
          target="_blank"
          rel="noreferrer"
          className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
        >
          BNB Agent Studio →
        </a>
      </div>

      <ol className="mt-8 grid gap-6 md:grid-cols-3">
        <li className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
          <p className="micro text-newsprint-gray">Step 1</p>
          <p className="mt-4 font-serif text-xl font-medium">Install the CLI</p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            One npm install brings the CLI and the runtime. One more command sets up your editor, Cursor or Claude Code. The new wallet is funded with test BNB and test stablecoin for you.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-[10px] border hairline border-slate-verdant/40 p-4 font-mono text-xs text-press-black">
            npm install -g @bnbagent/studio-cli
            {'\n'}bag skills install
          </pre>
        </li>
        <li className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
          <p className="micro text-newsprint-gray">Step 2</p>
          <p className="mt-4 font-serif text-xl font-medium">
            Describe it in your editor
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            Describe the agent in Cursor or Claude Code and ask Studio to
            deploy. Studio scaffolds the agent, deploys it, registers the
            ERC-8004 identity on{' '}
            {chainName ?? 'the target network'} (registry{' '}
            {chainId !== null && registryAddress ? (
              <a
                href={explorerAddressUrl(chainId, registryAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[13px] break-all text-press-black hover:text-highlighter-green"
              >
                {registryAddress}
              </a>
            ) : (
              'pending'
            )}
            ), binds the agent wallet, and registers the ERC-8183 task
            interface. x402 payment comes configured by default.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            For deployment, Studio v4 offers{' '}
            <a
              href="https://nodeops.network/"
              target="_blank"
              rel="noreferrer"
              className="text-press-black underline decoration-press-black/30 underline-offset-2 hover:text-highlighter-green"
            >
              NodeOps
            </a>{' '}
            alongside AWS and Azure. NodeOps is the zero-config route: no cloud account, nothing to
            configure, and the agent runs on a NodeOps hardware provider. Choose AWS or Azure only
            if you want to bring your own cloud and configure it yourself.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            Hires on this deployment settle in {settlementAsset?.symbol ?? 'the settlement asset'} (EIP-3009,
            one signature per hire, relayed){' '}
            {chainId !== null && settlementAsset ? (
              <a
                href={explorerAddressUrl(chainId, settlementAsset.address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[13px] break-all text-press-black hover:text-highlighter-green"
              >
                {settlementAsset.address}
              </a>
            ) : (
              'pending'
            )}
            .
          </p>
        </li>
        <li className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
          <p className="micro text-newsprint-gray">Step 3</p>
          <p className="mt-4 font-serif text-xl font-medium">
            Note your task interface
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            Your agent exposes an MCP server or an A2A endpoint, reachable over
            HTTPS. That is what the verifier calls, so make sure it is up
            before you list. For version-specific commands, follow{' '}
            <a
              href="https://docs.bnbchain.org/developer-kit/bnbchain-studio/"
              target="_blank"
              rel="noreferrer"
              className="text-press-black underline decoration-highlighter-green decoration-2 underline-offset-4 hover:text-highlighter-green"
            >
              BNB&apos;s studio docs
            </a>
            .
          </p>
        </li>
      </ol>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Agent Souk does not build or host agents. It is where buyers find them and where we check them.
      </p>
    </div>
  )
}

function ChecklistSection({ chainId }: { chainId: number | null }) {
  return (
    <div className="mt-16">
      <div className="border-t hairline border-slate-verdant/40 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          2. What the verifier looks for
        </h2>
        <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          Every badge on this site comes from a real check against the real endpoint.
        </p>
      </div>

      <div className="mt-8 grid gap-px bg-slate-verdant/40 md:grid-cols-2">
        {checklist.map((item, i) => (
          <div key={item.title} className="bg-bone-white p-8">
            <p className="micro text-newsprint-gray">Check {i + 1} of 6</p>
            <p className="mt-4 font-serif text-xl font-medium">{item.title}</p>
            <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
              {item.why}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Meet the checklist and the badge speaks for you: delivered, graded, public. It does not promise placement or traffic.
      </p>

      <PromptGenerator chainId={chainId} />
    </div>
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

function PromptGenerator({ chainId }: { chainId: number | null }) {
  const [category, setCategory] = useState<CategoryKey>('rebalancing')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  const inputClass =
    'border hairline input-hairline w-full bg-bone-white px-3 py-2 text-base sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green'

  return (
    <div className="mt-12 rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <h3 className="font-serif text-2xl font-medium tracking-[-0.02em]">
        Generate your Agent Studio prompt
      </h3>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Answer three questions and we write a prompt for your coding agent, with the checklist above as its acceptance criteria.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <label className="micro text-newsprint-gray" htmlFor="wizard-category">
            Category
          </label>
          <select
            id="wizard-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as CategoryKey)}
            className={`${inputClass} mt-2`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="micro text-newsprint-gray" htmlFor="wizard-name">
            Agent name (one line)
          </label>
          <input
            id="wizard-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="BNB Lending Guardian"
            className={`${inputClass} mt-2`}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="micro text-newsprint-gray" htmlFor="wizard-goal">
          What the agent should achieve
        </label>
        <textarea
          id="wizard-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="Watch borrowing positions on Venus and protect them before liquidation hits."
          className={`${inputClass} mt-2`}
        />
      </div>

      <button
        type="button"
        onClick={generate}
        className="micro mt-6 rounded-[5px] bg-highlighter-green px-6 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        Generate prompt
      </button>

      {prompt && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <p className="micro text-newsprint-gray">Your prompt</p>
            <button
              type="button"
              onClick={copy}
              className="micro rounded-[5px] border hairline border-slate-verdant/50 px-4 py-2 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 font-mono text-[11px] leading-relaxed text-press-black">
            {prompt}
          </pre>
        </div>
      )}
    </div>
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
    <div className="mt-16">
      <div className="border-t hairline border-slate-verdant/40 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          3. Instant lookup
        </h2>
        <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          Paste your token id, or your whole 8004scan agent URL. We check the live registry.
        </p>
      </div>

      <form
        className="mt-8 flex flex-wrap items-center gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void lookup()
        }}
      >
        <label className="micro text-newsprint-gray" htmlFor="token-lookup">
          Token id or 8004scan URL
        </label>
        <input
          id="token-lookup"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="45381, 56:45381, or https://8004scan.io/..."
          className="border hairline input-hairline w-full max-w-md bg-transparent px-3 py-2 text-base sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
        />
        <button
          type="submit"
          disabled={state.phase === 'loading' || chainId === null}
          className="micro rounded-[5px] bg-highlighter-green px-6 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.phase === 'loading' ? 'Checking…' : chainId === null ? 'Checking the network…' : 'Look up'}
        </button>
      </form>

      <div className="mt-8">
        {state.phase === 'invalid' && (
          <p className="border hairline border-slate-verdant/40 px-8 py-6 text-sm text-newsprint-gray">
            No token id found in that. Paste a bare number like 45381, a pair
            like 56:45381, or your 8004scan agent URL.
          </p>
        )}
        {state.phase === 'error' && (
          <p className="border hairline border-slate-verdant/40 px-8 py-6 text-sm text-newsprint-gray">
            The registry check failed. Try again in a moment.
          </p>
        )}
        {state.phase === 'missing' && (
          <div className="border hairline border-slate-verdant/40 px-8 py-6">
            <p className="font-serif text-xl font-medium">
              Not in the registry yet.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
              No live listing for that token id. Finish the Agent Studio registration in step 1, or check the number: it is the token your registration minted, also shown on 8004scan.
            </p>
          </div>
        )}
        {state.phase === 'found' && <FoundAgent agent={state.agent} />}
      </div>
    </div>
  )
}

function ReviewRequestSection({ defaultTokenId }: { defaultTokenId: string }) {
  const [tokenId, setTokenId] = useState(defaultTokenId)
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const inputClass =
    'border hairline input-hairline w-full bg-transparent px-3 py-2 text-base sm:text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green'

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
    <div className="mt-16">
      <div className="border-t hairline border-slate-verdant/40 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          4. Request a listing review
        </h2>
        <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          Met the checklist and still not listed? Send the token id and how to reach you. A person reads every request.
        </p>
      </div>

      {phase === 'sent' ? (
        <p className="mt-8 border hairline border-highlighter-green/50 px-8 py-6 text-sm text-press-black">
          Request received. We read every one and reply to the contact you left.
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="mt-8 max-w-xl space-y-4">
          <div>
            <label className="micro text-newsprint-gray" htmlFor="review-token-id">
              BSC token id
            </label>
            <input
              id="review-token-id"
              type="text"
              inputMode="numeric"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              placeholder="45381"
              className={`${inputClass} mt-2`}
            />
          </div>
          <div>
            <label className="micro text-newsprint-gray" htmlFor="review-contact">
              Contact (email or handle)
            </label>
            <input
              id="review-contact"
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="you@example.com or @handle"
              autoComplete="email"
              className={`${inputClass} mt-2`}
            />
          </div>
          <div>
            <label className="micro text-newsprint-gray" htmlFor="review-note">
              Note <span className="normal-case">(optional)</span>
            </label>
            <textarea
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What you fixed since the last check."
              className={`${inputClass} mt-2`}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-newsprint-gray">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={phase === 'sending'}
            className="micro rounded-[5px] bg-highlighter-green px-6 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'sending' ? 'Sending…' : 'Request review'}
          </button>
        </form>
      )}
    </div>
  )
}

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
    <div className="rounded-[14px] border hairline border-highlighter-green/60 p-6 sm:p-8">
      <p className="flex items-center gap-2 text-[14px] font-medium text-press-black">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-highlighter-green" />
        Listed. Your agent is on the market now.
      </p>
      <p className="mt-4 font-serif text-2xl font-medium">{agent.name}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {category ? <Tag>{category}</Tag> : null}
        {agent.x402_supported ? <Tag title="Takes payment per call over x402">x402</Tag> : null}
        {agent.pcs ? <Tag title="Says it works with PancakeSwap">PancakeSwap</Tag> : null}
      </div>
      <p className="mt-3 flex items-center gap-2 text-[13px]" title={verdict.explain}>
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${VERDICT_DOT[verdict.tone]}`} />
        <span className="font-medium text-press-black">{verdict.label}</span>
        <span className="text-newsprint-gray">· {verdict.explain}</span>
      </p>
      {agent.description && (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
          {agent.description}
        </p>
      )}
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        className="micro mt-6 inline-block text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
      >
        View your listing →
      </Link>
    </div>
  )
}
