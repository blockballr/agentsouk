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

  const set = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

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

  async function prepare() {
    setErrors([])
    setMessage(null)
    setBusy(true)
    try {
      // the claim records an owner, so connect first; the chain to be on comes from the server
      // response, not the client default, because the calldata is encoded for the server's chain
      const account = (await getActiveAccount()) ?? (await connectWallet())
      const res = await prepareRegistration(draft, account)
      setTargetChain(res.chainId)
      let onChain: string
      try {
        onChain = await ensureBscChain()
      } catch {
        setErrors([`Your wallet could not switch to ${chainLabel(res.chainId)}. Nothing was sent.`])
        return
      }
      if (onChain?.toLowerCase() !== chainIdToHex(res.chainId)) {
        setErrors([
          `Your wallet is on chain ${onChain}, not ${chainLabel(res.chainId)}. Nothing was sent.`,
        ])
        return
      }
      sentLatch.current = false
      setPrepared(res)
      setStep('prepared')
    } catch (e) {
      setErrors([(e as Error).message])
    } finally {
      setBusy(false)
    }
  }

  async function sign() {
    if (!prepared || txHash || sentLatch.current) return
    setMessage(null)
    setErrors([])
    setStep('signing')
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
      setMessage(
        err.code === 4001
          ? 'You cancelled the transaction, so nothing was registered.'
          : 'The registration could not be sent. Nothing was registered.',
      )
      setStep('prepared')
      return
    }

    // keep the hash before anything else can fail: from here the flow only ever checks this send
    sentLatch.current = true
    setTxHash(hash)
    await checkTransaction(hash)
  }

  async function checkTransaction(hash: `0x${string}`) {
    if (!prepared) return
    setErrors([])
    setStep('confirming')
    setMessage('Waiting for the transaction to confirm. This usually takes a few seconds.')
    try {
      const provider = await getProvider()
      const receipt = await waitForTransactionReceipt(
        () =>
          provider
            .request({ method: 'eth_getTransactionReceipt', params: [hash] })
            .then((r) => r as TransactionReceipt | null),
        {
          timeoutMs: RECEIPT_TIMEOUT_MS,
          intervalMs: RECEIPT_POLL_MS,
          onProgress: (elapsedMs) =>
            setMessage(
              `Waiting for the transaction to confirm (${Math.max(1, Math.round(elapsedMs / 1000))}s so far).`,
            ),
        },
      )

      // no receipt inside the budget means the transaction is still pending on the node, not failed
      if (!receipt) {
        setMessage(
          'Your wallet sent the transaction and it is still waiting to confirm. Check it again below; it will not be sent a second time.',
        )
        setStep('pending')
        return
      }

      const agentId = tokenIdFromReceipt(receipt.logs ?? [], prepared.registryAddress)
      if (!agentId) {
        setMessage(
          'The transaction is on the chain, but the registry did not report a new agent id. Do not send it again. Check the transaction or send us the hash and we will look at it.',
        )
        setStep('error')
        return
      }

      setMessage('The transaction confirmed. Checking the registry against the chain.')
      const confirmed = await confirmRegistration({
        claimId: prepared.claimId,
        agentId,
        txHash: hash,
      })
      setResult(confirmed)
      setStep(confirmed.status === 'confirmed' ? 'listed' : 'error')
      if (confirmed.status === 'refuted') {
        setMessage(confirmed.verification?.detail ?? 'The chain did not agree with that registration.')
      }
    } catch (e) {
      setMessage((e as Error).message)
      setStep('error')
    }
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
        <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
          That page reads the agent from the registry, so it is the place to watch
          as the index catches up. If the agent still has no category or no callable
          endpoint it will not be shelved; if it does not show there, send us the
          agent id above.
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

      {step === 'form' && (
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
            onClick={() => void prepare()}
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
