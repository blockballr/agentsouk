import { useState } from 'react'
import { formatUnits } from 'viem'
import {
  decodeGetJob,
  encodeDisputeWindow,
  encodeGetJob,
  encodeJobCalls,
  encodeJobCounter,
  jobDescription,
  jobStatusName,
  uintFromWord,
  type Eip1193Like,
  type Jobs8183Stack,
  type NegotiationQuoteView,
} from '../lib/jobs8183'
import { getJobs8183Quote } from '../lib/api'
import { chainIdToHex, ensureBscChain, getActiveAccount, getProvider, setTargetChain } from '../lib/wallet'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { explorerAddressUrl } from '../lib/contracts'
import { Action, button, cx } from './ui'

const FUND_DEADLINE_EXTRA_SECONDS = 1800

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
export default function Jobs8183HirePanel({ tokenId, chainId, name }: { tokenId: string; chainId: number; name: string }) {
  const [task, setTask] = useState('')
  const [account, setAccount] = useState<string | null>(null)
  const [quote, setQuote] = useState<NegotiationQuoteView | null>(null)
  const [stack, setStack] = useState<Jobs8183Stack | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function onQuote() {
    setError(null)
    setQuote(null)
    setStack(null)
    const client = (await getActiveAccount().catch(() => null)) as string | null
    if (!client) return setLines((l) => [...l, 'Connect the wallet first.'])
    setAccount(client)
    setPhase({ kind: 'quoting' })
    const result = await getJobs8183Quote({ tokenId, task, client, chainId })
    if (!result.ok) {
      setPhase({ kind: 'failed' })
      return setError(result.error)
    }
    setStack(result.stack)
    setQuote(result.quote)
    setPhase({ kind: 'quoted' })
  }

  async function onFund() {
    if (!account || !quote || !stack) return
    setError(null)
    setPhase({ kind: 'funding', done: 0 })
    try {
      const provider = (await getProvider()) as Eip1193Like
      setTargetChain(chainId)
      const chain = await ensureBscChain()
      if (chain?.toLowerCase() !== chainIdToHex(chainId)) {
        throw new Error(`Switch your wallet to this job's chain to fund it.`)
      }

      const counterWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.commerce, data: encodeJobCounter() }, 'latest'] })) as string
      const jobId = uintFromWord(counterWord) + 1n
      const windowWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.policy, data: encodeDisputeWindow() }, 'latest'] })) as string
      const disputeWindow = uintFromWord(windowWord)
      const expiredAt = BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + BigInt(FUND_DEADLINE_EXTRA_SECONDS)
      const description = jobDescription(task, quote)

      setLines((l) => [...l, `Funding job ${jobId.toString()} for ${formatUnits(BigInt(quote.price), 18)} of the kernel's token.`])

      const calls = encodeJobCalls(stack, { jobId, provider: quote.providerAddress, expiredAt, budgetRaw: BigInt(quote.price), description })
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i]
        setLines((l) => [...l, `Wallet signature ${i + 1} of ${calls.length}: ${call.label}.`])
        const hash = (await withSendTimeout(
          provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: call.to, data: call.data }] }),
        )) as `0x${string}`
        await waitForTransactionReceipt(() =>
          provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as Promise<TransactionReceipt | null>,
        )
        setPhase({ kind: 'funding', done: i + 1 })
      }

      const jobWord = (await provider.request({ method: 'eth_call', params: [{ to: stack.commerce, data: encodeGetJob(jobId) }, 'latest'] })) as string
      const job = decodeGetJob(jobWord)
      const state = job ? jobStatusName(job.status) : 'unknown'
      setLines((l) => [...l, `Job ${jobId.toString()} status: ${state}.`])
      setLines((l) => [...l, `The job is funded. The seller starts work; the escrow holds the price.`])
      setPhase({ kind: 'funded' })
    } catch (e) {
      setPhase({ kind: 'failed' })
      setError((e as Error).message || 'the fund step failed')
    }
  }

  const priceLabel = quote ? formatUnits(BigInt(quote.price), 18) : null

  return (
    <div className="mt-6">
      <label className="text-sm font-medium text-press-black" htmlFor="jobs8183-task">
        What should {name} do?
      </label>
      <textarea
        id="jobs8183-task"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={'Plan a grid ladder for 10000 USDT between 250 and 320.'}
        aria-label="Job text for the ERC-8183 seller"
        className="mt-2 w-full rounded-[5px] border border-slate-verdant/50 bg-white px-3 py-2 font-mono text-sm text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      />
      <p className="mt-2 text-xs leading-relaxed text-newsprint-gray">
        The agent quotes a price for the task. You fund the job on the shared kernel and the escrow holds the price until
        the work is delivered and settled.
      </p>

      {phase.kind === 'quoted' && quote && priceLabel && (
        <dl className="mt-4 space-y-2 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-newsprint-gray">Price</dt>
            <dd className="font-mono text-press-black">{priceLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-newsprint-gray">Seller wallet</dt>
            <dd className="font-mono text-press-black">{short(quote.providerAddress)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-newsprint-gray">Quote holds until</dt>
            <dd className="text-press-black">{new Date(quote.validUntil * 1000).toLocaleTimeString()}</dd>
          </div>
        </dl>
      )}

      {lines.length > 0 && (
        <div className="mt-4 space-y-1 rounded-[8px] border hairline p-3 font-mono text-xs text-newsprint-gray">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {error && (
        <p role="note" className="mt-3 rounded-[8px] border hairline border-slate-verdant/45 p-3 text-xs leading-relaxed text-newsprint-gray">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Action variant="primary" size="lg" onClick={onQuote} disabled={phase.kind === 'quoting' || task.trim().length === 0}>
          {phase.kind === 'quoting' ? 'Getting the price..' : 'Get the price'}
        </Action>
        {phase.kind === 'quoted' && (
          <Action variant="primary" size="lg" onClick={onFund}>
            Fund this job
          </Action>
        )}
        {phase.kind === 'funding' && (
          <Action variant="primary" size="lg" disabled>
            {`Signing ${phase.done} of 5..`}
          </Action>
        )}
        {phase.kind === 'funded' && (
          <span className="self-center text-sm text-press-black">The job is funded.</span>
        )}
      </div>

      {quote?.currency && (
        <p className="mt-3 text-xs text-newsprint-gray">
          Payment token: <span className="font-mono">{short(quote.currency)}</span>
          {' '}
          <a href={explorerAddressUrl(chainId, quote.currency)} target="_blank" rel="noreferrer" className="underline">
            on the explorer
          </a>
        </p>
      )}
      {error && phase.kind === 'failed' && (
        <button type="button" onClick={() => setPhase({ kind: 'idle' })} className={cx(button('secondary', 'sm'), 'mt-3')}>
          Try again
        </button>
      )}
    </div>
  )
}
