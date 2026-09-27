import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { categoryDef, classifyAgent } from '@agora/core'
import type { RegistrationDraft } from '@agora/core'
import {
  RECEIPT_POLL_MS,
  RECEIPT_TIMEOUT_MS,
  confirmRegistration,
  endpointRefusal,
  prepareRegistration,
  probeEndpoint,
  tokenIdFromReceipt,
  waitForTransactionReceipt,
  type ConfirmResult,
  type EndpointProbe,
  type PrepareResult,
  type TransactionReceipt,
} from '../lib/register'
import { VerificationLoop, type CheckLine, type CheckState } from './VerificationLoop'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import {
  chainIdToHex,
  connectWallet,
  ensureBscChain,
  getActiveAccount,
  getProvider,
  setTargetChain,
} from '../lib/wallet'

// pending means the wallet already sent a transaction and we are waiting on its receipt, so the
// only control from there is a check, never a second send
type Step =
  | 'form'
  | 'prepared'
  | 'signing'
  | 'confirming'
  | 'pending'
  | 'listed'
  | 'error'

const CATEGORY_OPTIONS: { value: RegistrationDraft['category']; label: string }[] = [
  { value: 'yield', label: 'Yield' },
  { value: 'grid-trading', label: 'Grid trading' },
  { value: 'rebalancing', label: 'Rebalancing' },
  { value: 'health-factor', label: 'Health factor' },
]

const EMPTY: RegistrationDraft = {
  name: '',
  description: '',
  category: 'yield',
  endpoint: '',
  endpointKind: 'A2A',
  image: '',
  x402Support: true,
}

// The checks the marketplace applies, in the order it applies them. The old form checked the
// endpoint and the category in separate places; this list is the whole judgement in one place.
type LoopId = 'endpoint' | 'card' | 'classifier' | 'terms' | 'transaction' | 'confirm' | 'sweep'

const SWEEP_DETAIL =
  'Nothing in this wizard earns the badge. Once the registration is confirmed, the verifier probes the registered endpoint on its next sweep; the badge it awards follows whether that endpoint answers, not anything done here.'

function initialChecks(): CheckLine[] {
  return [
    { id: 'endpoint', title: 'Endpoint address rule', state: 'waiting' },
    { id: 'card', title: 'The agent card answers', state: 'waiting' },
    { id: 'classifier', title: 'Category the classifier assigns', state: 'waiting' },
    { id: 'terms', title: 'Registration terms from the server', state: 'waiting' },
    { id: 'transaction', title: 'Transaction sent and mined', state: 'waiting' },
    { id: 'confirm', title: 'Registration confirmed on chain', state: 'waiting' },
    { id: 'sweep', title: 'The verification sweep, after this', state: 'waiting', detail: SWEEP_DETAIL },
  ]
}

// A synchronous check needs one painted frame between its checking state and its result.
function nextPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

/** The listing wizard: fill the draft, review the document, register from the owner's wallet, then let the server check the chain. */
export function RegisterWizard({ chainId }: { chainId: number }) {
  const [step, setStep] = useState<Step>('form')
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY)
  const [errors, setErrors] = useState<string[]>([])
  const [prepared, setPrepared] = useState<PrepareResult | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [probe, setProbe] = useState<EndpointProbe | null>(null)
  const [probing, setProbing] = useState(false)
  // latched in the same tick as the send, so a repeat click can never reach eth_sendTransaction twice
  const sentLatch = useRef(false)
  // null until the lister proceeds; each entry updates as its check runs
  const [checks, setChecks] = useState<CheckLine[] | null>(null)

  const set = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const mark = (id: LoopId, state: CheckState, detail?: string) =>
    setChecks((prev) =>
      prev
        ? prev.map((c) =>
            c.id === id ? { ...c, state, ...(detail !== undefined ? { detail } : {}) } : c,
          )
        : prev,
    )

  async function testEndpoint() {
    setProbe(null)
    setProbing(true)
    try {
      setProbe(await probeEndpoint(draft.endpoint ?? ''))
    } finally {
      setProbing(false)
    }
  }

  // a deterministic address or scheme fault is refused before the transaction; the browser probe
  // never blocks, because a cross-origin block is not proof the endpoint is down
  const endpointFault = endpointRefusal(draft.endpoint ?? '')

  // The whole judgement the marketplace applies, run in order the moment the lister proceeds, with
  // each step reporting its own real outcome as it happens rather than all at once at the end.
  async function runChecks() {
    setErrors([])
    setMessage(null)
    setBusy(true)
    setChecks(initialChecks())

    // 1. the deterministic address rule, the same rule src/lib/endpoint.ts enforces server-side
    mark('endpoint', 'checking')
    await nextPaint()
    const endpoint = (draft.endpoint ?? '').trim()
    const endpointReason = endpoint
      ? endpointRefusal(endpoint)
      : 'No endpoint yet. The registry requires an https URL a buyer can call, so this would be rejected before it was registered.'
    if (endpointReason) {
      mark('endpoint', 'failed', endpointReason)
      setBusy(false)
      return
    }
    mark(
      'endpoint',
      'passed',
      'An https URL that is not a loopback or private address, so the marketplace can call it.',
    )

    // 2. the card is probed from the browser; a cross-origin block is unverified, never a failure
    mark('card', 'checking')
    const probeResult = await probeEndpoint(endpoint)
    setProbe(probeResult)
    if (probeResult.state === 'answered') {
      mark('card', 'passed', probeResult.detail)
    } else if (probeResult.state === 'unverified') {
      mark('card', 'undetermined', probeResult.detail)
    } else {
      mark('card', 'failed', probeResult.detail)
      setBusy(false)
      return
    }

    // 3. the classifier, not the dropdown, decides the shelf. A general reading still registers,
    // so it is reported as a failure to shelve rather than a reason to stop the loop.
    mark('classifier', 'checking')
    await nextPaint()
    const text = `${draft.name} ${draft.description}`.trim()
    if (!text) {
      mark(
        'classifier',
        'failed',
        'The name and description are both empty, so the classifier has nothing to place and the shelf has no category to file it under.',
      )
    } else {
      const { category } = classifyAgent(text)
      if (category === 'general') {
        mark(
          'classifier',
          'failed',
          'The name and description read as general, not one of the four categories. Registration still succeeds, but the shelf has nothing to file it under, so it will not appear. Say what the agent does in the category words: rebalancing, LP ranges, grid trading, yield or APR, health factor.',
        )
      } else {
        mark(
          'classifier',
          'passed',
          `The classifier reads this as ${categoryDef(category).label}, so that is the shelf it will appear under.`,
        )
      }
    }

    // 4. the server mints the document and returns the terms; the chain to be on comes from its
    // response, not the client default, because the calldata is encoded for the server's chain
    mark('terms', 'checking')
    try {
      const account = (await getActiveAccount()) ?? (await connectWallet())
      const res = await prepareRegistration(draft, account)
      setTargetChain(res.chainId)
      let onChain: string
      try {
        onChain = await ensureBscChain()
      } catch {
        const detail = `Your wallet could not switch to ${chainLabel(res.chainId)}. Nothing was sent.`
        mark('terms', 'failed', detail)
        setErrors([detail])
        return
      }
      if (onChain?.toLowerCase() !== chainIdToHex(res.chainId)) {
        const detail = `Your wallet is on chain ${onChain}, not ${chainLabel(res.chainId)}. Nothing was sent.`
        mark('terms', 'failed', detail)
        setErrors([detail])
        return
      }
      sentLatch.current = false
      setPrepared(res)
      mark(
        'terms',
        'passed',
        `The server prepared the document at ${res.agentUri}, for ${chainLabel(res.chainId)} against registry ${res.registryAddress}.`,
      )
      setStep('prepared')
    } catch (e) {
      const detail = (e as Error).message
      mark('terms', 'failed', detail)
      setErrors([detail])
    } finally {
      setBusy(false)
    }
  }

  async function sign() {
    if (!prepared || txHash || sentLatch.current) return
    setMessage(null)
    setErrors([])
    setStep('signing')
    mark('transaction', 'checking', 'Waiting for your wallet to sign and send the transaction.')
    let hash: `0x${string}`
    try {
      const provider = await getProvider()
      const account = (await getActiveAccount()) ?? (await connectWallet())
      // sent from the participant's own wallet, so the registry records them as owner
      hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: account,
            to: prepared.registryAddress,
            data: prepared.registerCalldata,
          },
        ],
      })) as `0x${string}`
    } catch (e) {
      const err = e as Error & { code?: number }
      const detail =
        err.code === 4001
          ? 'You cancelled the transaction, so nothing was registered.'
          : 'The registration could not be sent. Nothing was registered.'
      mark('transaction', 'failed', detail)
      setMessage(detail)
      setStep('prepared')
      return
    }

    // keep the hash before anything else can fail: from here the flow only ever checks this send
    sentLatch.current = true
    setTxHash(hash)
    mark('transaction', 'checking', `Sent ${hash}. Waiting for the transaction to confirm.`)
    await checkTransaction(hash)
  }

  async function checkTransaction(hash: `0x${string}`) {
    if (!prepared) return
    setErrors([])
    setStep('confirming')
    setMessage('Waiting for the transaction to confirm. This usually takes a few seconds.')
    mark('transaction', 'checking', 'Waiting for the transaction to confirm (0s so far).')

    let receipt: TransactionReceipt | null
    try {
      const provider = await getProvider()
      receipt = await waitForTransactionReceipt(
        () =>
          provider
            .request({ method: 'eth_getTransactionReceipt', params: [hash] })
            .then((r) => r as TransactionReceipt | null),
        {
          timeoutMs: RECEIPT_TIMEOUT_MS,
          intervalMs: RECEIPT_POLL_MS,
          onProgress: (elapsedMs) => {
            const detail = `Waiting for the transaction to confirm (${Math.max(1, Math.round(elapsedMs / 1000))}s so far).`
            setMessage(detail)
            mark('transaction', 'checking', detail)
          },
        },
      )
    } catch (e) {
      const detail = (e as Error).message
      mark('transaction', 'failed', detail)
      setMessage(detail)
      setStep('error')
      return
    }

    // no receipt inside the budget means the transaction is still pending on the node, not failed
    if (!receipt) {
      const detail =
        'Your wallet sent the transaction and it is still waiting to confirm. Check it again below; it will not be sent a second time.'
      mark('transaction', 'undetermined', detail)
      setMessage(detail)
      setStep('pending')
      return
    }

    mark(
      'transaction',
      'passed',
      'The transaction mined. Reading the registry receipt for the new agent id.',
    )

    const agentId = tokenIdFromReceipt(receipt.logs ?? [], prepared.registryAddress)
    if (!agentId) {
      const detail =
        'The transaction is on the chain, but the registry did not report a new agent id. Do not send it again. Check the transaction or send us the hash and we will look at it.'
      mark('confirm', 'failed', detail)
      setMessage(detail)
      setStep('error')
      return
    }

    setMessage('The transaction confirmed. Checking the registry against the chain.')
    mark(
      'confirm',
      'checking',
      'The server is reading the registry against the chain to prove ownership and the agent id.',
    )
    let confirmed: ConfirmResult
    try {
      confirmed = await confirmRegistration({
        claimId: prepared.claimId,
        agentId,
        txHash: hash,
      })
    } catch (e) {
      const detail = (e as Error).message
      mark('confirm', 'failed', detail)
      setMessage(detail)
      setStep('error')
      return
    }

    setResult(confirmed)
    if (confirmed.status === 'confirmed') {
      mark('confirm', 'passed', confirmed.verification?.detail ?? 'The chain agrees with the registration.')
      setStep('listed')
      return
    }
    const detail = confirmed.verification?.detail ?? 'The chain did not agree with that registration.'
    mark('confirm', 'failed', detail)
    setMessage(detail)
    setStep('error')
  }

  // the server says which chain the calldata is for, so links and labels follow it, not the client default
  const displayChain = prepared?.chainId ?? chainId

  if (step === 'listed' && result) {
    return (
      <div className="rounded-[14px] border hairline border-highlighter-green/50 bg-highlighter-green/5 p-8">
        <h3 className="font-serif text-2xl font-medium">Your agent is registered</h3>
        <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
          The registry confirms it, so this is real rather than pending. What happens
          next is not instant: the catalogue reads the chain again and the agent
          appears on the shelf, usually within a minute, if it has a callable
          endpoint and a category the classifier assigns. The verifier calls it on
          its next sweep and puts a grade on the badge.
        </p>
        {checks && (
          <div className="mt-5">
            <VerificationLoop checks={checks} />
          </div>
        )}
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="micro text-newsprint-gray">Agent id</dt>
            <dd className="mt-1 font-mono text-xs text-press-black">{result.agentId}</dd>
          </div>
          <div>
            <dt className="micro text-newsprint-gray">Registration</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              <a
                href={`${explorerTxBase(displayChain)}/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-press-black hover:text-highlighter-green"
              >
                {result.txHash}
              </a>
            </dd>
          </div>
        </dl>
        <Link
          to={`/agents/${displayChain}/${result.agentId}`}
          className="micro mt-6 inline-block rounded-[5px] border hairline border-slate-verdant/50 px-5 py-2.5 text-press-black transition hover:bg-bone-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Open the agent page
        </Link>
        <Link
          to="/profile"
          className="micro mt-6 ml-3 inline-block rounded-[5px] border hairline border-slate-verdant/50 px-5 py-2.5 text-press-black transition hover:bg-bone-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Open your listings
        </Link>
        <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
          Your profile lists every agent this wallet owns, whether it is live, and
          who hired it. That page reads the agent from the registry, so it is the
          place to watch as the index catches up. If the agent still has no
          category or no callable endpoint it will not be shelved; if it does not
          show there, send us the agent id above.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <h3 className="font-serif text-2xl font-medium">Register your agent</h3>
      <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
        Describe the agent, then send the ERC-8004 registration from your own wallet. You pay the
        gas for that one transaction, and nothing is charged by us. Registration is on{' '}
        {chainLabel(displayChain)}.
      </p>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="micro text-newsprint-gray">Name</span>
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            disabled={busy || step !== 'form'}
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-sm text-press-black disabled:opacity-60"
            placeholder="Venus Yield Router"
          />
        </label>

        <label className="block">
          <span className="micro text-newsprint-gray">What it does</span>
          <textarea
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            disabled={busy || step !== 'form'}
            rows={4}
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-sm text-press-black disabled:opacity-60"
            placeholder="What it does, and how a buyer invokes it."
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="micro text-newsprint-gray">Category</span>
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value as RegistrationDraft['category'])}
              disabled={busy || step !== 'form'}
              className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-sm text-press-black disabled:opacity-60"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="micro text-newsprint-gray">How it is invoked</span>
            <select
              value={draft.endpointKind}
              onChange={(e) => {
                set('endpointKind', e.target.value as RegistrationDraft['endpointKind'])
                setProbe(null)
              }}
              disabled={busy || step !== 'form'}
              className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-sm text-press-black disabled:opacity-60"
            >
              <option value="A2A">A2A</option>
              <option value="MCP">MCP</option>
              <option value="web">Web</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="micro text-newsprint-gray">Endpoint</span>
          <input
            value={draft.endpoint}
            onChange={(e) => {
              set('endpoint', e.target.value)
              setProbe(null)
            }}
            disabled={busy || step !== 'form'}
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-xs text-press-black disabled:opacity-60"
            placeholder="https://your-agent.example/.well-known/agent-card.json"
          />
          <span className="mt-1 block text-xs text-newsprint-gray">
            A reachable https URL. An agent nobody can call is not a listing.
          </span>
        </label>
      </div>

      {/* the pre-flight card is the idle form; once the loop runs, the stepped panel replaces it */}
      {step === 'form' && checks === null && (
        <div className="mt-5 rounded-[10px] border hairline border-slate-verdant/40 p-4">
          <p className="micro text-newsprint-gray">Before you spend gas</p>
          <p className="mt-2 text-xs leading-relaxed text-newsprint-gray">
            A registration can succeed on chain and still be useless on the shelf.
            Two things decide that: the endpoint has to answer, and the classifier
            has to place the agent in one of the four categories.
          </p>

          {endpointFault ? (
            <EndpointProbeResult probe={{ state: 'refused', detail: endpointFault }} />
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={probing || busy}
                  onClick={() => void testEndpoint()}
                  className="micro rounded-[5px] border hairline border-slate-verdant/50 px-4 py-2 text-press-black transition hover:bg-bone-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
                >
                  {probing ? 'Asking the endpoint' : 'Test the endpoint'}
                </button>
                <span className="text-xs leading-relaxed text-newsprint-gray">
                  The request comes from your browser, never from our servers.
                </span>
              </div>
              {probe && <EndpointProbeResult probe={probe} />}
            </>
          )}

          {draft.endpointKind === 'web' && (
            <div className="mt-3 rounded-[8px] border border-press-black/20 bg-bone-white p-3 text-xs leading-relaxed text-press-black">
              <p className="micro">Web will not appear on the shelf</p>
              <p className="mt-1">
                The registration records a web service, but the marketplace only
                shelves A2A and MCP endpoints. A Web listing would register and then
                stay invisible. Pick whichever of A2A or MCP the agent actually
                speaks.
              </p>
            </div>
          )}

          <CategoryCheck draft={draft} />
        </div>
      )}

      {checks && (
        <div className="mt-5">
          <VerificationLoop checks={checks} />
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-[10px] border border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {message && (
        <p className="mt-4 rounded-[10px] border border-press-black/20 bg-bone-white p-4 text-xs leading-relaxed text-press-black">
          {message}
        </p>
      )}

      {prepared && step !== 'form' && (
        <div className="mt-5 rounded-[10px] border hairline border-slate-verdant/40 p-4">
          <p className="micro text-newsprint-gray">This will be published at</p>
          <p className="mt-2 break-all font-mono text-[11px] text-press-black">{prepared.agentUri}</p>
          <a
            href={prepared.agentUri}
            target="_blank"
            rel="noreferrer"
            className="micro mt-2 inline-block text-newsprint-gray underline hover:text-press-black"
          >
            Read the document first
          </a>
        </div>
      )}

      <div className="mt-6">
        {step === 'form' && (
          <button
            type="button"
            disabled={busy || endpointFault !== null}
            onClick={() => void runChecks()}
            className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-typesetter-ink transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {endpointFault
              ? 'Fix the endpoint before registering'
              : busy
                ? 'Preparing'
                : 'Continue to registration'}
          </button>
        )}

        {step === 'prepared' && !txHash && (
          <button
            type="button"
            onClick={() => void sign()}
            className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-typesetter-ink transition hover:brightness-95 disabled:opacity-60"
          >
            Sign the registration in your wallet
          </button>
        )}

        {(step === 'signing' || step === 'confirming') && (
          <button
            type="button"
            disabled
            className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-typesetter-ink opacity-60"
          >
            {step === 'signing' ? 'Waiting for your wallet' : 'Waiting for the transaction to confirm'}
          </button>
        )}

        {/* once a hash exists the only control is a check of that send, so no click can send it twice */}
        {txHash && (step === 'pending' || step === 'prepared' || step === 'error') && (
          <button
            type="button"
            onClick={() => void checkTransaction(txHash)}
            className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-4 text-typesetter-ink transition hover:brightness-95 disabled:opacity-60"
          >
            Check the transaction again
          </button>
        )}

        {step === 'error' && !txHash && (
          <button
            type="button"
            onClick={() => setStep('prepared')}
            className="micro w-full rounded-[5px] border hairline border-slate-verdant/50 px-6 py-3 text-center text-newsprint-gray transition hover:text-press-black"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function EndpointProbeResult({ probe }: { probe: EndpointProbe }) {
  const label =
    probe.state === 'answered'
      ? 'Endpoint answers'
      : probe.state === 'refused'
        ? 'Endpoint refused'
        : 'Could not verify'
  const tone =
    probe.state === 'answered'
      ? 'border-highlighter-green/50 text-press-black'
      : probe.state === 'refused'
        ? 'border-press-black/30 text-press-black'
        : 'border-slate-verdant/45 text-newsprint-gray'
  return (
    <div
      role="status"
      className={`mt-3 rounded-[8px] border hairline p-3 text-xs leading-relaxed ${tone}`}
    >
      <p className="micro">{label}</p>
      <p className="mt-1">{probe.detail}</p>
    </div>
  )
}

// The classifier reads the name and description, not the category dropdown, so a
// listing whose text reads as general is registered but never shelved.
function CategoryCheck({ draft }: { draft: RegistrationDraft }) {
  const text = `${draft.name} ${draft.description}`.trim()
  if (!text) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-newsprint-gray">
        The classifier reads the name and the description. With both still empty it
        has nothing to place, so this would register as general and stay off the
        shelf.
      </p>
    )
  }
  const { category } = classifyAgent(text)
  if (category === 'general') {
    return (
      <div className="mt-3 rounded-[8px] border border-press-black/20 bg-bone-white p-3 text-xs leading-relaxed text-press-black">
        <p className="micro">The classifier will not place this</p>
        <p className="mt-1">
          The name and description read as general, so the shelf has no category to
          file this under and it would not appear in one of the four. Say what the
          agent does in the category&apos;s own words, for example rebalancing or LP
          ranges, grid trading, yield or APR, or health factor and liquidation.
        </p>
      </div>
    )
  }
  return (
    <p className="mt-3 text-xs leading-relaxed text-newsprint-gray">
      The classifier reads this as {categoryDef(category).label}, so that is the
      shelf it would appear under.
    </p>
  )
}
