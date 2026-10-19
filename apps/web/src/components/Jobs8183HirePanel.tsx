import { useState } from 'react'
import { formatUnits } from 'viem'
import {
  decodeGetJob,
  encodeBalanceOf,
  encodeDisputeWindow,
  encodeGetJob,
  encodeJobCalls,
  encodeJobCounter,
  tryBundledFund,
  jobDescription,
  jobStatusName,
  uintFromWord,
  type Eip1193Like,
  type Jobs8183Stack,
  type NegotiationQuoteView,
} from '../lib/jobs8183'
import { getJobs8183Quote, recordJobs8183Job } from '../lib/api'
import { chainIdToHex, ensureBscChain, getProvider, setTargetChain } from '../lib/wallet'
import { connectWallet, sessionAccount } from '../lib/wallet-session'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { Btn, Pill, Row, Stack, Txt } from './souk'
import { SupportButton } from './SupportButton'

const FUND_DEADLINE_EXTRA_SECONDS = 1800

// the five stops an ERC-8183 job sells in
const STOPS = ['Quoted', 'Funded', 'Working', 'Submitted', 'Released']

function short(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'quoting' }
  | { kind: 'quoted' }
  | { kind: 'funding'; done: number }
  | { kind: 'funded' }
  | { kind: 'failed' }

// The buy side of an ERC-8183 job: the buyer's task goes to the negotiate
// route, the validated quote comes back priced on the shared kernel's own
// token, and the buyer's wallet signs the five calls that lock the price into
// the kernel's escrow. Nothing here signs money away from the marketplace;
// every signature is the buyer's own call on a public contract.
// one written task per category, so the card opens with something the seller can
// actually price
const DEFAULT_TASK: Record<string, string> = {
  'grid-trading': 'Plan a grid ladder for 10000 USDT between 250 and 320.',
  yield: 'What is the net APR for moving 10000 USDT into Venus on BNB Smart Chain?',
  'health-factor': 'Compute the health factor for collateral 1000 USD and debt 500 USD.',
  rebalancing: 'Should this portfolio rebalance, and where should the allocation go?',
}

export default function Jobs8183HirePanel({
  tokenId,
  chainId,
  cards = true,
  category,
}: {
  tokenId: string
  chainId: number
  // a job seller's column carries the two cards; a dual-rail listing draws the
  // same content inside the x402 card, so it asks for the pair without the shells
  cards?: boolean
  category?: string
}) {
  // a quote needs a task, so the card opens with one written for this agent's
  // category rather than an empty box that leaves the price button dead. The grid
  // line is the design's own; the rest borrow the wording the quest writes its
  // tasks in, and a rebalance asks the question without naming a figure
  const seed = DEFAULT_TASK[category ?? ''] ?? DEFAULT_TASK['grid-trading']
  const [task, setTask] = useState(seed)
  const [account, setAccount] = useState<string | null>(null)
  const [quote, setQuote] = useState<NegotiationQuoteView | null>(null)
  const [stack, setStack] = useState<Jobs8183Stack | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  // a refusal asking again cannot undo stops the card from offering the ask; the
  // text it failed on decides when the button comes back
  const [failure, setFailure] = useState<'transient' | 'definitive' | null>(null)
  const [asked, setAsked] = useState('')

  async function onQuote() {
    setError(null)
    setQuote(null)
    setStack(null)
    let client = (await sessionAccount().catch(() => null)) as string | null
    // a press without a wallet opens the connection instead of stacking an error line
    if (!client) {
      try {
        client = await connectWallet()
      } catch {
        setError('Connect the wallet first.')
        return
      }
    }
    setAccount(client)
    setPhase({ kind: 'quoting' })
    const text = task
    const result = await getJobs8183Quote({ tokenId, task: text, client, chainId })
    if (!result.ok) {
      setPhase({ kind: 'failed' })
      setFailure(result.transient ? 'transient' : 'definitive')
      if (!result.transient) setAsked(text)
      return setError(result.error)
    }
    setFailure(null)
    setStack(result.stack)
    setQuote(result.quote)
    setPhase({ kind: 'quoted' })
  }

  async function onFund() {
    if (!account || !quote || !stack) return
    setError(null)
    setLines([])
    setPhase({ kind: 'funding', done: 0 })
    try {
      const provider = (await getProvider()) as Eip1193Like
      setTargetChain(chainId)
      const chain = await ensureBscChain()
      if (chain?.toLowerCase() !== chainIdToHex(chainId)) {
        throw new Error(`Switch your wallet to this job's chain to fund it.`)
      }

      if (quote.validUntil * 1000 <= Date.now() + 15_000) {
        throw new Error('This price has expired. Get a fresh quote before funding.')
      }

      const budget = BigInt(quote.price)
      const balanceWord = (await provider.request({
        method: 'eth_call',
        params: [{ to: stack.paymentToken, data: encodeBalanceOf(account) }, 'latest'],
      })) as string
      const balance = uintFromWord(balanceWord)
      if (balance < budget) {
        throw new Error(
          `This wallet holds ${formatUnits(balance, 18)} $U, but the job needs ${formatUnits(budget, 18)} $U. Add $U before funding; nothing was sent.`,
        )
      }

      const counterWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.commerce, data: encodeJobCounter() }, 'latest'] })) as string
      const jobId = uintFromWord(counterWord) + 1n
      const windowWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.policy, data: encodeDisputeWindow() }, 'latest'] })) as string
      const disputeWindow = uintFromWord(windowWord)
      const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + BigInt(FUND_DEADLINE_EXTRA_SECONDS)
      const description = jobDescription(task, quote)

      setLines((l) => [...l, `Funding job ${jobId.toString()} for ${formatUnits(budget, 18)} of the kernel's token.`])

      const calls = encodeJobCalls(stack, { jobId, provider: quote.providerAddress, expiredAt, budgetRaw: budget, description })
      // Prefer one bundled approval (EIP-5792) when the wallet supports it; the
      // five calls still run in order on chain, but the buyer approves once.
      // Fall back to the sequential popups for wallets that do not speak it.
      const bundled = await tryBundledFund(provider, chainId, account, calls)
      if (bundled.supported && bundled.ok) {
        setLines((l) => [...l, `Batched fund: 1 approval for ${calls.length} calls.`])
        setPhase({ kind: 'funding', done: calls.length })
      } else if (bundled.supported && !bundled.ok) {
        throw new Error(bundled.error)
      } else {
        for (let i = 0; i < calls.length; i++) {
          const call = calls[i]
          setLines((l) => [...l, `Wallet signature ${i + 1} of ${calls.length}: ${call.label}.`])
          const hash = (await withSendTimeout(
            provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: call.to, data: call.data }] }),
          )) as `0x${string}`
          const receipt = await waitForTransactionReceipt(() =>
            provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as Promise<TransactionReceipt | null>,
          )
          if (!receipt) {
            throw new Error(`Signature ${i + 1} of ${calls.length} did not confirm. ${hash}`)
          }
          if (receipt.status !== '0x1' && receipt.status !== 'success') {
            throw new Error(`Signature ${i + 1} of ${calls.length} failed: ${call.label}. ${hash}`)
          }
          setPhase({ kind: 'funding', done: i + 1 })
        }
      }

      const jobWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.commerce, data: encodeGetJob(jobId) }, 'latest'] })) as string
      const job = decodeGetJob(jobWord)
      const state = job ? jobStatusName(job.status) : 'unknown'
      setLines((l) => [...l, `Job ${jobId.toString()} status: ${state}.`])
      if (!job || job.status !== 1) {
        throw new Error(`The job is ${state} on chain, not Funded. Nothing is held and nothing was recorded.`)
      }
      let recorded = false
      let acknowledged = false
      try {
        const logged = await recordJobs8183Job({ tokenId, kernelJobId: jobId, client: account, chainId })
        if (!logged.ok) {
          setLines((l) => [...l, `The escrow is funded, but the marketplace could not record the job: ${logged.error}`])
          setError(`The escrow holds the price, but this job is not in your ongoing view. Keep job ${jobId.toString()} and contact support.`)
        } else {
          recorded = true
          acknowledged = logged.notify.ok
          setLines((l) => [...l, logged.notify.ok ? `The seller acknowledged the funded job.` : `No ack back yet: ${logged.notify.reply.slice(0, 120)}`])
          setLines((l) => [...l, `The job now lives in your ongoing view.`])
        }
      } catch {
        setLines((l) => [...l, `The escrow is funded, but the marketplace could not be reached to record it.`])
        setError(`The escrow holds the price, but this job is not in your ongoing view yet. Keep job ${jobId.toString()}.`)
      }
      if (recorded) {
        setLines((l) => [
          ...l,
          acknowledged
            ? `The job is funded. The seller starts work; the escrow holds the price.`
            : `The job is funded and recorded. The seller has not acknowledged yet; the chain still holds the price.`,
        ])
      }
      try {
        const key = `jobs8183:funded:${chainId}:${tokenId}`
        const prev = JSON.parse(localStorage.getItem(key) ?? '[]') as number[]
        if (!prev.includes(Number(jobId))) prev.push(Number(jobId))
        localStorage.setItem(key, JSON.stringify(prev))
      } catch {
        // storage is best effort; the job is still on chain
      }
      setPhase({ kind: 'funded' })
    } catch (e) {
      setPhase({ kind: 'failed' })
      setError((e as Error).message || 'the fund step failed')
    }
  }

  const priceLabel = quote ? formatUnits(BigInt(quote.price), 18) : null
  const funded = phase.kind === 'funded'
  const holds = quote ? new Date(quote.validUntil * 1000).toLocaleTimeString() : null
  const blocked = phase.kind === 'failed' && failure === 'definitive' && task === asked

  const jobBody = (
    <Stack gap={14}>
      {/* the design's hire card for a job seller: the task the seller prices, the
          meter that says where the job is, and the one action the stage allows.
          bare mode is drawn inside a card that already carries the head and the
          framing copy, and its framing copy would be wrong for an agent a direct
          hire also reaches */}
        {cards && (
          <>
            <Row justify="between" align="center">
              <Txt size={18} lead={27} weight="bold" tone="ink">
                {funded ? 'Your funded job' : 'Fund job'}
              </Txt>
              <Pill variant="keep">{funded ? 'funded' : 'erc-8183'}</Pill>
            </Row>

            <Txt size={13} lead={20} tone="slate">
              {funded
                ? 'The job is funded on chain, so the escrow holds the price and the seller has been told to start. Work is released the only way it can be: by the seller delivering it.'
                : 'This agent sells through its own ERC-8183 job, so a direct paid hire cannot reach it. Ask for a signed price, then fund the job on chain.'}
            </Txt>
          </>
        )}

        <Txt size={10} lead={14} weight="bold" upper tone="muted">
          {funded ? 'Job text, locked when the job was funded' : 'Job text'}
        </Txt>
        <div className="rounded-[8px] border border-souk-hair bg-souk-surface2 px-[14px] py-3">
          <textarea
            id="jobs8183-task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={3}
            spellCheck={false}
            readOnly={funded}
            placeholder={seed}
            aria-label="Job text for the ERC-8183 seller"
            className="w-full resize-none bg-transparent font-mono text-[11px] leading-[17px] text-souk-slate placeholder:text-souk-muted focus-visible:outline-none"
          />
        </div>

        {/* the one element the product itself supplies: five stops, zero until
            the price is asked, 20% once the quote lands, 40% once the money is
            in escrow */}
        <Meter pct={funded ? 40 : quote ? 20 : 0} pending={phase.kind === 'quoting'} />

        {funded ? (
          <StopRail at={1} />
        ) : (
          <Txt size={11} lead={16} mono tone="steel">
            {STOPS.join(' → ')}
          </Txt>
        )}

        <Txt size={13} lead={20} tone="slate">
          {funded
            ? 'Stage 2 of 5: the job is funded. The escrow holds the money, and the seller\'s accepted work is the only thing that releases it.'
            : quote
              ? 'Stage 1 of 5: the seller has signed a price in $U. Nothing is funded yet, so no money has moved.'
              : 'Stage 1 of 5: ask the seller for a price in $U. Nothing is agreed yet, so no money has moved.'}
        </Txt>

        {funded ? (
          <Stack gap={2}>
            <Row justify="between" align="center">
              <Txt size={10} lead={16} weight="bold" upper tone="muted">Funded</Txt>
              <Txt size={12} lead={18} mono tone="data">
                {priceLabel ? `${priceLabel} of the kernel's token, held` : 'held in escrow'}
              </Txt>
            </Row>
            <Row justify="between" align="center">
              <Txt size={10} lead={16} weight="bold" upper tone="muted">Released</Txt>
              <Txt size={12} lead={18} mono tone="muted">nothing yet</Txt>
            </Row>
          </Stack>
        ) : null}

        {quote && priceLabel ? (
          <Stack gap={2}>
            <Row justify="between" align="center">
              <Txt size={10} lead={16} weight="bold" upper tone="muted">Price</Txt>
              <Txt size={12} lead={18} mono tone="data">{priceLabel}</Txt>
            </Row>
            <Row justify="between" align="center">
              <Txt size={10} lead={16} weight="bold" upper tone="muted">Seller wallet</Txt>
              <Txt size={12} lead={18} mono tone="slate">{short(quote.providerAddress)}</Txt>
            </Row>
            {holds ? (
              <Row justify="between" align="center">
                <Txt size={10} lead={16} weight="bold" upper tone="muted">Quote holds until</Txt>
                <Txt size={12} lead={18} mono tone="slate">{holds}</Txt>
              </Row>
            ) : null}
          </Stack>
        ) : null}

        {lines.length > 0 ? (
          <div className="space-y-1 rounded-[8px] border border-souk-edge p-3 font-mono text-[11px] leading-[16px] text-souk-muted">
            {lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}

        {error ? (
          <Txt size={12} lead={18} tone="peach" className="block">
            {error}
          </Txt>
        ) : null}

        {/* a definitive refusal says what it means for the card, and the reason
            above stays the seller's or the guard's own words */}
        {error && phase.kind === 'failed' && failure === 'definitive' ? (
          <Txt size={13} lead={20} tone="slate">
            No signed price came back, so this card cannot fund a job.
          </Txt>
        ) : null}

        {error ? <SupportButton /> : null}

        {!blocked ? (
          <Stack gap={12}>
            <Btn
              kind="primary"
              className="w-full"
              onClick={() => (phase.kind === 'quoted' && quote ? onFund() : onQuote())}
              disabled={funded || phase.kind === 'quoting' || phase.kind === 'funding' || task.trim().length === 0}
            >
              {funded
                ? 'The job is funded'
                : phase.kind === 'quoting'
                  ? 'Getting the price..'
                  : phase.kind === 'quoted'
                    ? 'Fund this job'
                    : phase.kind === 'funding'
                      ? `Signing ${Math.min(phase.done + 1, 5)} of 5..`
                      : 'Get the price'}
            </Btn>
            <Txt size={12} lead={18} tone="muted">
              {funded
                ? 'Delivery is attested by the seller and settles to its own wallet.'
                : 'The quote is signed by the wallet that registered this listing and holds for 10 minutes.'}
            </Txt>
          </Stack>
        ) : null}

        {quote?.currency ? (
          <Txt size={12} lead={18} tone="muted">
            Payment token <span className="font-mono">{short(quote.currency)}</span>
            {' · '}
            <a href={explorerAddressUrl(chainId, quote.currency)} target="_blank" rel="noreferrer" className="underline">
              on the explorer
            </a>
          </Txt>
        ) : null}
    </Stack>
  )

  const quoteBody = (
    <Stack gap={10}>
      {/* the design's signed quote card, the terms the signature actually carries */}
        <Txt size={18} lead={27} weight="bold" tone="ink" className="border-b border-souk-hair pb-[9px]">
          Signed quote
        </Txt>
        <Txt size={13} lead={20} tone="slate">
          {quote && priceLabel ? 'A signed price for the task above.' : 'No quote yet.'}
        </Txt>
        <SpecRow k="Price" v={priceLabel ? `${priceLabel} of the kernel's token` : "signed in $U by the seller's wallet"} />
        <SpecRow k="Terms" v="deliverables and quality standards" />
        <SpecRow k="Holds for" v="10 minutes, then it is worthless" />
        <SpecRow k="Funds" v="one transaction on BSC mainnet 56" />
    </Stack>
  )

  // bare mode is drawn inside a card that supplies its own head, copy and quote,
  // so only the task, the meter and the stage carry over
  if (!cards) {
    return <Stack gap={16}>{jobBody}</Stack>
  }
  return (
    <>
      <Stack bg="surface1" radius={20} hair pad={[20, 22, 20, 22]} className="w-full">
        {jobBody}
      </Stack>
      <Stack bg="surface1" radius={20} hair pad={[20, 22, 20, 22]} className="w-full">
        {quoteBody}
      </Stack>
    </>
  )
}

// the job progression meter: one label, one figure, and a six pixel rail whose fill
// runs from the navy surface into the data green, so the head of the bar is always
// the colour it is reaching for. the fill never teleports: while the price is being
// fetched it crawls toward the stop it waits on, lands with the quote, and falls
// back when the answer is no
function Meter({ pct, pending }: { pct: number; pending: boolean }) {
  return (
    <Stack gap={8}>
      <Row justify="between" align="center">
        <Txt size={11} lead={16} weight="bold" upper tone="muted">Job progression</Txt>
        <Txt size={14} lead={18} mono weight="bold" tone={pct >= 90 ? 'peach' : 'data'}>{pct}%</Txt>
      </Row>
      <div className="h-[6px] w-full overflow-hidden rounded-[3px] bg-souk-hair">
        <div
          className={`meter-fill relative h-full rounded-[3px] transition-[width] ease-out motion-reduce:transition-none ${pending ? 'duration-[2200ms]' : 'duration-700'}`}
          style={{
            width: `${pending ? 19 : Math.max(pct, 2)}%`,
            minWidth: 6,
            backgroundImage: 'linear-gradient(90deg, #111a4a 0%, #44b48b 100%)',
          }}
        >
          {pending ? (
            <span
              aria-hidden="true"
              className="meter-shimmer absolute inset-y-0 left-0 w-[40%] rounded-[3px] bg-gradient-to-r from-transparent via-white/70 to-transparent"
            />
          ) : null}
        </div>
      </div>
    </Stack>
  )
}

// the five stops an ERC-8183 job sells in, drawn as rail: dots for what is passed,
// a ring on the one in force, labels under each
export function StopRail({ at }: { at: number }) {
  return (
    <Stack gap={8}>
      <Row align="center" gap={0}>
        {STOPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <span
              className={`flex h-[10px] w-[10px] shrink-0 rounded-full ${
                i === at
                  ? 'bg-souk-data ring-2 ring-souk-sky/85'
                  : i < at
                    ? 'bg-souk-data'
                    : 'border border-souk-steel/50'
              }`}
            />
            {i < STOPS.length - 1 ? <span className="h-px flex-1 bg-souk-hair" /> : null}
          </div>
        ))}
      </Row>
      <Row align="center" gap={0}>
        {STOPS.map((s, i) => (
          <span
            key={s}
            className={`flex-1 text-center font-mono text-[11px] uppercase leading-[16px] ${
              i <= at ? 'font-bold text-souk-ink' : 'font-semibold text-souk-muted'
            }`}
          >
            {s}
          </span>
        ))}
      </Row>
    </Stack>
  )
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="micro w-[96px] shrink-0 font-bold text-souk-muted">{k}</span>
      <span className="text-[12px] leading-[18px] text-souk-labels">{v}</span>
    </div>
  )
}
