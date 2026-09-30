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
  withSendTimeout,
  type ConfirmResult,
  type EndpointProbe,
  type PrepareResult,
  type TransactionReceipt,
} from '../lib/register'
import { VerificationLoop, type CheckLine, type CheckState } from './VerificationLoop'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import {
  chainIdToHex,
  changeWallet,
  connectWallet,
  ensureBscChain,
  getActiveAccount,
  getProvider,
  setTargetChain,
} from '../lib/wallet'
import { button, card, cx } from './ui'

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

// The skeleton a lister can start from. It is deliberately a shape rather than a
// finished sentence, because a description that everyone pastes verbatim would
// classify the same way and tell a buyer nothing.
const TEMPLATE_DESCRIPTION =
  'Computes <the result> for <the position or portfolio the caller supplies>, from <the inputs the caller passes in>. It returns <the fields in the reply>. The arithmetic is deterministic and uses no market data, so the caller supplies the valuation.'

// The checks the marketplace applies, in the order it applies them. The old form checked the
// endpoint and the category in separate places; this list is the whole judgement in one place.
type LoopId = 'endpoint' | 'card' | 'classifier' | 'terms' | 'transaction' | 'confirm' | 'sweep'

const SWEEP_DETAIL =
  'Nothing in this wizard earns the badge. Once the registration is confirmed, the verifier probes the registered endpoint on its next sweep; the badge it awards follows whether that endpoint answers, not anything done here.'

function initialChecks(): CheckLine[] {
  return [
    { id: 'endpoint', title: 'Endpoint address rule', state: 'waiting' },
    { id: 'card', title: 'The agent card answers', state: 'waiting' },
    { id: 'classifier', title: 'Shelf category and search words', state: 'waiting' },
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

// A wallet that never answers must not leave the lister watching a spinner. The
// connection phase is the safe place to give up, because nothing has been sent
// yet, so a retry cannot become a second transaction.
const WALLET_TIMEOUT_MS = 25_000

function withWalletTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          'Your wallet did not answer. Unlock it or open it, then press the button below to try again. Nothing was sent.',
        ),
      )
    }, WALLET_TIMEOUT_MS)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
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

    // 3. the shelf files the agent under the category chosen in the form, so this
    // check reports what search and relevance read, and that still runs on the text.
    mark('classifier', 'checking')
    await nextPaint()
    const text = `${draft.name} ${draft.description}`.trim()
    const shelfTab = categoryDef(draft.category).label
    if (!text) {
      mark(
        'classifier',
        'passed',
        `The shelf files this under ${shelfTab}. The description is empty, so search has nothing to match and a buyer reading the page learns nothing before hiring.`,
      )
    } else {
      const { category } = classifyAgent(text)
      if (category === 'general') {
        mark(
          'classifier',
          'passed',
          `The shelf files this under ${shelfTab}. The description reads as general, so the words buyers search for will not reach it: say what the agent does in that category's own words, such as rebalancing, LP ranges, grid trading, yield or APR, health factor.`,
        )
      } else {
        mark(
          'classifier',
          'passed',
          `The shelf files this under ${shelfTab}, and the description also reads as ${categoryDef(category).label}, so search reaches it both ways.`,
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
      // the wallet opens on its own, so the lister is not left wondering whether
      // anything happened; the button stays as the fallback for a wallet that
      // refuses an unprompted request
      await nextPaint()
      void sign(res)
    } catch (e) {
      const detail = (e as Error).message
      mark('terms', 'failed', detail)
      setErrors([detail])
    } finally {
      setBusy(false)
    }
  }

  // A wallet that will not answer is not something to keep retrying: dropping the
  // stored choice and picking again is the way out, and it is safe here because
  // nothing has been sent yet.
  async function changeAndSign() {
    if (txHash || sentLatch.current) return
    setMessage(null)
    setErrors([])
    try {
      const next = await withWalletTimeout(changeWallet())
      if (!next) {
        setMessage('No wallet was chosen, so nothing was sent.')
        return
      }
    } catch (e) {
      setMessage((e as Error).message)
      return
    }
    await sign()
  }

  async function sign(target: PrepareResult | null | undefined = prepared) {
    if (!target || txHash || sentLatch.current) return
    setMessage(null)
    setErrors([])
    setStep('signing')
    mark('transaction', 'checking', 'Asking your wallet to sign and send the transaction.')
    let hash: `0x${string}`
    try {
      const provider = await withWalletTimeout(getProvider())
      const account =
        (await getActiveAccount()) ?? (await withWalletTimeout(connectWallet()))
      // sent from the participant's own wallet, so the registry records them as owner
      hash = (await withSendTimeout(
        provider.request({
          method: 'eth_sendTransaction',
          params: [
            {
              from: account,
              to: target.registryAddress,
              data: target.registerCalldata,
            },
          ],
        }) as Promise<`0x${string}`>,
      )) as `0x${string}`
    } catch (e) {
      const err = e as Error & { code?: number }
      // the timeout's own sentence is the useful one, because it says what to do
      const detail =
        err.code === 4001
          ? 'You cancelled the transaction, so nothing was registered.'
          : err.message.includes('did not answer')
            ? err.message
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
    await checkTransaction(hash, target)
  }

  async function checkTransaction(hash: `0x${string}`, target: PrepareResult | null | undefined = prepared) {
    if (!target) return
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

    const agentId = tokenIdFromReceipt(receipt.logs ?? [], target.registryAddress)
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
        claimId: target.claimId,
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
      // no probe here: a fresh token is not indexed yet, so an instant probe finds no endpoint
      // and that verdict would stand for twenty hours; the sweep checks it once it is indexed
      if (draft.endpointKind !== 'web') {
        mark('sweep', 'waiting', 'The verifier probes it on its next sweep, once the registry has indexed it. You can re-check it any time from your profile.')
      }
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
    // the shelf decides separately from the chain, so its verdict is reported here
    // instead of on a profile that will not show the agent at all
    const refused = result.listed === false
    const shelfTab = categoryDef(draft.category).label
    return (
      <div
        className={`rounded-[14px] border hairline p-8 ${
          refused
            ? 'border-slate-verdant/60 bg-bone-white'
            : 'border-highlighter-green/50 bg-highlighter-green/5'
        }`}
      >
        <h3 className="font-serif text-2xl font-medium">
          {refused ? 'Registered, but not on the shelf' : 'Your agent is registered'}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
          {refused ? (
            `The registry confirms the registration, so the token is yours and the transaction below is real. The shelf declined to carry it: ${
              result.listingReason ?? 'it did not pass the shelf gate'
            }. The registration stands either way, and the catalogue reads the chain again on its next pull, so a listing whose endpoint starts answering publicly is shelved then.`
          ) : (
            `The registry confirms it, so the registration is settled. The shelf files it under ${shelfTab}, and the catalogue reads the chain again, so it appears within a minute. A browser-invoked listing appears too, but the marketplace cannot call it, so a hire cannot run automatically. The verifier probes a callable endpoint on its next sweep, once the registry has indexed it, and the badge follows what it finds. You can re-check it any time from your profile.`
          )}
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
          className={cx(button('secondary', 'lg'), 'mt-6')}
        >
          Open the agent page
        </Link>
        <Link
          to="/profile"
          className={cx(button('secondary', 'lg'), 'mt-6 ml-3')}
        >
          Open your listings
        </Link>
        <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
          {refused
            ? 'Your profile lists every agent this wallet owns and whether it is live, so this one shows there as registered while it stays off the shelf. The reason above is the whole story: if it names the endpoint, fixing the endpoint is what lets the next catalogue pull shelve it. If it does not show there, send us the agent id above.'
            : 'Your profile lists every agent this wallet owns, whether it is live, and who hired it. That page reads the agent from the registry, so it is the place to watch as the index catches up. If the agent declares no endpoint, or one that does not answer publicly, it will not be shelved; a browser-invoked listing appears, but is not callable by the marketplace. If it does not show there, send us the agent id above.'}
        </p>
      </div>
    )
  }

  return (
    <div className={card('plain', 'lg')}>
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
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-base sm:text-sm text-press-black disabled:opacity-60"
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
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-base sm:text-sm text-press-black disabled:opacity-60"
            placeholder="What it does, and how a buyer invokes it."
          />
        </label>

        {/* the category select below files the shelf; this text is what search,
            relevance and buyers read, so a description that names the capability
            does real work for the lister either way */}
        <div className="rounded-[10px] border hairline border-slate-verdant/40 p-4">
          <p className="micro text-newsprint-gray">What a description has to say</p>
          <p className="mt-2 text-xs leading-relaxed text-newsprint-gray">
            The shelf files your agent under the category you pick below. Search,
            relevance and buyers read these words instead, so name the capability in
            plain words from that category&apos;s own vocabulary ({
              CATEGORY_OPTIONS.map((c) => c.label).join(', ')
            }), say what the caller supplies, say what comes back, and say what the
            agent does not do, so nobody expects a live price feed from arithmetic.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-press-black">
            Worked example for a health factor agent: computes the health factor and
            liquidation distance of a lending position from the collateral value and debt
            value the caller supplies, with an optional liquidation threshold. The
            arithmetic is deterministic and uses no market data, so the caller supplies the
            valuation and can reproduce every figure.
          </p>
          <button
            type="button"
            disabled={busy || step !== 'form'}
            onClick={() => set('description', TEMPLATE_DESCRIPTION)}
            className={cx(button('secondary', 'sm'), 'mt-3')}
          >
            Start from the template
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="micro text-newsprint-gray">Category</span>
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value as RegistrationDraft['category'])}
              disabled={busy || step !== 'form'}
              className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-base sm:text-sm text-press-black disabled:opacity-60"
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
              className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-base sm:text-sm text-press-black disabled:opacity-60"
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
            className="mt-1 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-base sm:text-xs text-press-black disabled:opacity-60"
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
            A registration can succeed on-chain and still sit unseen. Two things decide it: the endpoint must answer, and the description must say plainly what the agent does.
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
                  className={button('secondary', 'md')}
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
              <p className="micro">Web listings appear, but the marketplace cannot call them</p>
              <p className="mt-1">
                A browser-invoked agent is listed, but the marketplace cannot call it, so a hire records the payment and nothing is delivered. Pick A2A or MCP if your agent speaks either.
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
            className={cx(button('primary', 'xl'), 'w-full')}
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
            className={cx(button('primary', 'xl'), 'w-full')}
          >
            Sign the registration in your wallet
          </button>
        )}

        {/* the escape hatch when a wallet will not answer: forget the stored choice
            and pick another, which is only offered while nothing has been sent */}
        {step === 'prepared' && !txHash && (
          <button
            type="button"
            onClick={() => void changeAndSign()}
            className="micro mt-3 w-full rounded-[5px] border hairline border-slate-verdant/50 px-6 py-3 text-center text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
          >
            Use a different wallet
          </button>
        )}

        {(step === 'signing' || step === 'confirming') && (
          <button
            type="button"
            disabled
            className={cx(button('primary', 'xl'), 'w-full opacity-60')}
          >
            {step === 'signing' ? 'Waiting for your wallet' : 'Waiting for the transaction to confirm'}
          </button>
        )}

        {/* once a hash exists the only control is a check of that send, so no click can send it twice */}
        {txHash && (step === 'pending' || step === 'prepared' || step === 'error') && (
          <button
            type="button"
            onClick={() => void checkTransaction(txHash)}
            className={cx(button('primary', 'xl'), 'w-full')}
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

// The shelf files under the category chosen in the form; this reports what search
// will read, because the text still decides whether buyers reach the listing.
function CategoryCheck({ draft }: { draft: RegistrationDraft }) {
  const shelfTab = categoryDef(draft.category).label
  const text = `${draft.name} ${draft.description}`.trim()
  if (!text) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-newsprint-gray">
        The shelf files this under {shelfTab}. With the name and description still
        empty, search has nothing to match and a buyer reading the page learns
        nothing before hiring.
      </p>
    )
  }
  const { category } = classifyAgent(text)
  if (category === 'general') {
    return (
      <div className="mt-3 rounded-[8px] border border-press-black/20 bg-bone-white p-3 text-xs leading-relaxed text-press-black">
        <p className="micro">The description does not name a category</p>
        <p className="mt-1">
          The shelf files this under {shelfTab} either way, but the text reads as
          general, so buyers searching for it will not reach it. Say what the agent
          does in the category&apos;s own words, for example rebalancing or LP
          ranges, grid trading, yield or APR, or health factor and liquidation.
        </p>
      </div>
    )
  }
  return (
    <p className="mt-3 text-xs leading-relaxed text-newsprint-gray">
      The shelf files this under {shelfTab}, and the description also reads as{' '}
      {categoryDef(category).label}, so search reaches it both ways.
    </p>
  )
}
