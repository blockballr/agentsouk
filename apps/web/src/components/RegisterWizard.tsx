import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { categoryDef, classifyAgent } from '@agora/core'
import type { RegistrationDraft } from '@agora/core'
import {
  RECEIPT_POLL_MS,
  RECEIPT_TIMEOUT_MS,
  CardCheckRefused,
  confirmRegistration,
  endpointRefusal,
  prepareRegistration,
  probeEndpoint,
  readAgentCard,
  tokenIdFromReceipt,
  waitForTransactionReceipt,
  withSendTimeout,
  type ConfirmResult,
  type EndpointProbe,
  type PrepareResult,
  type TransactionReceipt,
} from '../lib/register'
import type { CheckLine, CheckState } from './VerificationLoop'
import { Btn } from './souk'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import {
  chainIdToHex,
  changeWallet,
  ensureBscChain,
  getProvider,
  setTargetChain,
} from '../lib/wallet'
import { connectWallet, sessionAccount } from '../lib/wallet-session'
import { SupportButton } from './SupportButton'
import { button, card, cx } from './ui'

// pending means the wallet already sent a transaction and we are waiting on its receipt, so the
// only control from there is a check, never a second send
export type WizardStep =
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
  // no silent default: an unchosen category falls back to the classifier
  // instead of filing the listing under yield
  category: '',
  endpoint: '',
  // a listing may speak more than one protocol, so this is a list
  endpointKinds: ['A2A'],
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
type LoopId =
  | 'endpoint'
  | 'card'
  | 'classifier'
  | 'job'
  | 'terms'
  | 'transaction'
  | 'confirm'
  | 'sweep'

const SWEEP_DETAIL =
  'Nothing in this wizard earns the badge. Once the registration is confirmed, the verifier probes the registered endpoint on its next sweep; the badge it awards follows whether that endpoint answers, not anything done here.'

export function initialChecks(mode: 'job' | 'call' | 'both'): CheckLine[] {
  const before: CheckLine[] = [
    { id: 'endpoint', title: 'Endpoint address rule', state: 'waiting' },
    { id: 'card', title: 'The agent card answers', state: 'waiting' },
    { id: 'classifier', title: 'Shelf category and search words', state: 'waiting' },
  ]
  const jobLine: CheckLine[] =
    mode !== 'call'
      ? [{ id: 'job', title: 'The card declares the job protocol (ERC-8183)', state: 'waiting' }]
      : []
  const after: CheckLine[] = [
    { id: 'terms', title: 'Registration terms from the server', state: 'waiting' },
    { id: 'transaction', title: 'Transaction sent and mined', state: 'waiting' },
    { id: 'confirm', title: 'Registration confirmed on chain', state: 'waiting' },
    { id: 'sweep', title: 'The verification sweep, after this', state: 'waiting', detail: SWEEP_DETAIL },
  ]
  // the job line runs inside the terms step, so it sits before it, and only on the job branch
  return [...before, ...jobLine, ...after]
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
export function RegisterWizard({
  chainId,
  onStep,
  onChecks,
}: {
  chainId: number
  onStep?: (step: WizardStep) => void
  onChecks?: (checks: CheckLine[] | null) => void
}) {
  const [step, setStep] = useState<WizardStep>('form')
  // lets the page's quest guide follow where the wizard has got to
  useEffect(() => {
    onStep?.(step)
  }, [step, onStep])
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY)
  const [importId, setImportId] = useState('')
  const [importErr, setImportErr] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
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
  // tracks whether the pasted image url actually loads, so a dead link shows
  // the default face instead of a broken image
  const [imageOk, setImageOk] = useState(true)
  // how the listing sells: a call listing takes paid calls, a job listing takes
  // ERC-8183 jobs only, and a both listing declares x402 while also taking jobs
  const [mode, setMode] = useState<'job' | 'call' | 'both'>('job')

  // the endpoint is the first thing the lister gives us, and the rest of the form
  // only appears once it is usable. The flag latches so a correction does not
  // collapse the details under the lister.
  const [detailsOpen, setDetailsOpen] = useState(false)
  // idle until a usable endpoint settles: reading, read, or unread from this browser
  const [cardState, setCardState] = useState<'idle' | 'reading' | 'read' | 'unread'>('idle')

  // Only the listing intent opens on the endpoint. Arriving from the build routes
  // leaves the page on the section that was asked for, rather than dragging it
  // down to this field.
  const endpointRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (window.location.pathname !== '/list') return
    const hash = window.location.hash
    if (hash && hash !== '#register-here') return
    endpointRef.current?.focus()
  }, [])

  // the list page draws the same panel in its side rail, so the wizard reports its
  // checks outward instead of holding the panel itself. Before the checks run it
  // reports the 0% state for the chosen mode, so the whole bar is visible from the start.
  useEffect(() => {
    onChecks?.(checks ?? initialChecks(mode))
  }, [checks, mode, onChecks])

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

  // the card a pasted endpoint serves carries the agent's own name, words and
  // face; they fill the empty fields after the url settles, so the lister
  // confirms what the agent already says instead of retyping it. A filled field
  // is never touched again: whatever the lister typed outranks the card.
  useEffect(() => {
    const endpoint = (draft.endpoint ?? '').trim()
    if (!endpoint || endpointRefusal(endpoint)) {
      setCardState('idle')
      return
    }
    let cancelled = false
    setCardState('reading')
    const timer = setTimeout(() => {
      void readAgentCard(endpoint).then((card) => {
        if (cancelled) return
        if (!card) {
          setCardState('unread')
          return
        }
        setCardState('read')
        setDraft((d) => ({
          ...d,
          name: d.name?.trim() ? d.name : card.name ?? d.name,
          description: d.description?.trim() ? d.description : card.description ?? d.description,
          image: d.image?.trim() ? d.image : card.image ?? d.image,
        }))
      })
    }, 700)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft.endpoint])

  // the shortcut: the wallet the page already knows, connected first when it does
  // not know one, so the field carries the address rather than a typed guess
  async function fillWallet() {
    const addr = (await sessionAccount().catch(() => null)) ?? (await connectWallet())
    if (addr) set('agentWallet', addr)
  }

  // the mode answer drives what the claim mints: x402 rides the document, forced off for a job
  // seller, which refuses a direct paid task by construction, and back on for a call listing
  function chooseMode(next: 'job' | 'call' | 'both') {
    setMode(next)
    // job-only turns the direct rail off; both declares x402 while taking escrow work
    set('x402Support', next !== 'job')
    // the rail follows the branch: a job listing has its own line, so a mode change
    // returns the panel to its 0% state for the checks that will actually run
    setChecks(null)
  }

  // a deterministic address or scheme fault is refused before the transaction; the browser probe
  // never blocks, because a cross-origin block is not proof the endpoint is down
  const endpointFault = endpointRefusal(draft.endpoint ?? '')

  // a listing that already exists on chain carries the endpoint we should read, so a
  // lister who registered elsewhere pastes the id instead of hunting the URL down
  async function importToken() {
    const id = importId.trim().replace(/^#/, '')
    if (!/^\d+$/.test(id)) {
      setImportErr('A token id is digits only.')
      return
    }
    setImporting(true)
    setImportErr(null)
    try {
      const base = import.meta.env.VITE_API_URL ?? '/api'
      const res = await fetch(`${base}/agents/${chainId}/${id}`)
      const body = (await res.json()) as Record<string, unknown>
      const agent = ((body?.data ?? body) ?? {}) as Record<string, unknown>
      const url = String(agent.a2a_endpoint ?? agent.agent_url ?? agent.mcp_server ?? '').trim()
      if (!url) {
        setImportErr('That listing has no callable endpoint.')
        return
      }
      set('endpoint', url)
    } catch {
      setImportErr('Could not read that token.')
    } finally {
      setImporting(false)
    }
  }

  // once the endpoint is a usable https URL the details open, prefilled from the
  // card it serves; the endpoint itself stays the first field and stays editable
  const endpointReady = (draft.endpoint ?? '').trim().length > 0 && endpointFault === null
  useEffect(() => {
    if (endpointReady) setDetailsOpen(true)
  }, [endpointReady])

  // the picture is cosmetic and never blocks: the registry takes an https URL or
  // nothing, so an http or unparsable address is said out loud and the listing
  // falls back to the default face
  const imageRaw = (draft.image ?? '').trim()
  const imageUsable = /^https:\/\/\S+$/i.test(imageRaw)
  const imageFault = imageRaw && !imageUsable ? 'Needs a public https address.' : null
  // the wallet field is refused here in the same shape the route refuses it, so a
  // bad address never reaches the claim it would be minted into; the job branch also
  // requires one, because that wallet is who gets paid when a job releases
  const walletRaw = (draft.agentWallet ?? '').trim()
  const walletFault = !walletRaw
    ? mode !== 'call'
      ? 'A job seller is paid from this wallet when a job releases, so the address is required: paste it, or press "Use my connected wallet".'
      : null
    : !/^0x[0-9a-fA-F]{40}$/.test(walletRaw)
      ? 'That is not an EVM address: 0x followed by forty hex characters.'
      : /^0x0{40}$/i.test(walletRaw)
        ? 'A payment to the zero address is burned. Use the address that should be paid.'
        : null

  // The whole judgement the marketplace applies, run in order the moment the lister proceeds, with
  // each step reporting its own real outcome as it happens rather than all at once at the end.
  async function runChecks() {
    setErrors([])
    setMessage(null)
    setBusy(true)
    // a wallet the route would refuse stops here, before any check spends a paint
    if (walletFault) {
      setErrors([walletFault])
      setBusy(false)
      return
    }
    setChecks(initialChecks(mode))

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
    const shelfTab = draft.category ? categoryDef(draft.category).label : 'a category you pick'
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
    if (mode !== 'call') mark('job', 'checking')
    try {
      const account = (await sessionAccount()) ?? (await connectWallet())
      const res = await prepareRegistration(draft, account, mode)
      if (res.cardCheck) mark('job', 'passed', res.cardCheck.detail)
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
      // the card refusal owns the job line and stops before the server minted anything, so the
      // terms line reads as not attempted rather than failed
      if (e instanceof CardCheckRefused) {
        mark('job', 'failed', e.message)
        mark(
          'terms',
          'waiting',
          'Not attempted: the card check refused the job branch before the server minted the document. Nothing was sent.',
        )
        setErrors([e.message])
        return
      }
      const detail = (e as Error).message
      if (mode !== 'call') mark('job', 'undetermined', `Not completed: ${detail}`)
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
        (await sessionAccount()) ?? (await withWalletTimeout(connectWallet()))
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
      if ((draft.endpointKinds ?? []).some((k) => k !== 'web')) {
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
    const shelfTab = draft.category ? categoryDef(draft.category).label : 'a category you pick'
    return (
      <div
        className={`metal rounded-[14px] border hairline p-8 ${
          refused
            ? 'border-souk-hair bg-souk-surface2'
            : 'border-souk-data bg-souk-data/10'
        }`}
      >
        <h3 className="font-serif text-2xl font-medium">
          {refused ? 'Registered, but not on the shelf' : 'Your agent is registered'}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-souk-muted">
          {refused ? (
            `The registry confirms the registration, so the token is yours and the transaction below is real. The shelf declined to carry it: ${
              result.listingReason ?? 'it did not pass the shelf gate'
            }. The registration stands either way, and the catalogue reads the chain again on its next pull, so a listing whose endpoint starts answering publicly is shelved then.`
          ) : (
            `The registry confirms it, so the registration is settled. The shelf files it under ${shelfTab}, and the catalogue reads the chain again, so it appears within a minute. A browser-invoked listing appears too, but the marketplace cannot call it, so a hire cannot run automatically. The verifier probes a callable endpoint on its next sweep, once the registry has indexed it, and the badge follows what it finds. You can re-check it any time from your profile.`
          )}
        </p>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="micro text-souk-muted">Agent id</dt>
            <dd className="mt-1 font-mono text-xs text-souk-ink">{result.agentId}</dd>
          </div>
          <div>
            <dt className="micro text-souk-muted">Registration</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              <a
                href={`${explorerTxBase(displayChain)}/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-souk-ink hover:text-souk-data"
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
        <p className="mt-4 text-sm leading-relaxed text-souk-muted">
          {refused
            ? 'Your profile lists every agent this wallet owns and whether it is live, so this one shows there as registered while it stays off the shelf. The reason above is the whole story: if it names the endpoint, fixing the endpoint is what lets the next catalogue pull shelve it. If it does not show there, send us the agent id above.'
            : 'Your profile lists every agent this wallet owns, whether it is live, and who hired it. That page reads the agent from the registry, so it is the place to watch as the index catches up. If the agent declares no endpoint, or one that does not answer publicly, it will not be shelved; a browser-invoked listing appears, but is not callable by the marketplace. If it does not show there, send us the agent id above.'}
        </p>
      </div>
    )
  }

  return (
    <div className={cx(card('plain', 'lg'), 'overflow-hidden')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-2xl font-medium">List your agent</h3>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-souk-muted">
            Paste the endpoint first. We read the agent card it serves and fill the listing, then
            you edit anything before paying gas. Registration is on {chainLabel(displayChain)}.
          </p>
        </div>
        <span className="micro shrink-0 rounded-full border border-souk-hair px-3 py-1 text-souk-muted">
          {detailsOpen ? 'Step 2 of 2' : 'Step 1 of 2'}
        </span>
      </div>

      <div className="mt-6 space-y-5">
        <ol className="grid gap-2 sm:grid-cols-3">
          {[
            ['1', 'Paste the endpoint', 'or an existing token id'],
            ['2', 'Confirm the card', 'name, words, category'],
            ['3', 'Register on chain', 'one transaction'],
          ].map(([n, label, detail]) => (
            <li key={n} className="flex items-center gap-3 border border-souk-hair bg-souk-surface1 px-3 py-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center border border-souk-hair font-mono text-[10px] text-souk-data">
                {n}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold leading-4 text-souk-ink">{label}</span>
                <span className="block font-mono text-[10px] leading-4 text-souk-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <section className="border border-souk-hair bg-souk-surface1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="micro text-souk-ink">1. The endpoint a buyer calls</p>
            <CardState state={cardState} />
          </div>

          <label className="mt-3 block">
            <span className="micro text-souk-muted">Endpoint</span>
            <input
              id="endpoint-input"
              ref={endpointRef}
              value={draft.endpoint}
              onChange={(e) => {
                set('endpoint', e.target.value)
                setProbe(null)
              }}
              disabled={busy || step !== 'form'}
              className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2.5 font-mono text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-xs"
              placeholder="https://your-agent.example/.well-known/agent-card.json"
            />
            {endpointFault ? (
              <span className="mt-1.5 block text-xs leading-relaxed text-souk-peach">
                {endpointFault}
              </span>
            ) : (
              <span className="mt-1.5 block text-xs leading-relaxed text-souk-muted">
                A reachable https URL. The card it serves fills the next step.
              </span>
            )}
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-souk-hair pt-3">
            <span className="micro text-souk-muted">Already on chain?</span>
            <input
              value={importId}
              onChange={(e) => {
                setImportId(e.target.value)
                setImportErr(null)
              }}
              inputMode="numeric"
              placeholder="ERC-8004 token id"
              className="h-9 w-[170px] border border-souk-hair bg-souk-surface2 px-2.5 font-mono text-xs text-souk-ink outline-none focus:border-souk-sky"
            />
            <Btn kind="off" disabled={importing || importId.trim().length === 0} onClick={() => void importToken()}>
              {importing ? 'Reading…' : 'Use its endpoint'}
            </Btn>
            {importErr ? <span className="text-xs text-souk-peach">{importErr}</span> : null}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="micro text-souk-muted">How it is invoked</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(['A2A', 'MCP', 'web'] as const).map((kind) => {
                  const selected = (draft.endpointKinds ?? []).includes(kind)
                  return (
                    <label
                      key={kind}
                      className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2 text-sm text-souk-ink transition hover:border-souk-sky"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={busy || step !== 'form'}
                        onChange={() => {
                          set('endpointKinds', selected
                            ? (draft.endpointKinds ?? []).filter((k) => k !== kind)
                            : [...(draft.endpointKinds ?? []), kind])
                          setProbe(null)
                        }}
                        className="h-4 w-4 rounded border-souk-hair text-souk-sky focus:ring-souk-sky"
                      />
                      {kind}
                    </label>
                  )
                })}
              </div>
            </label>
            <button
              type="button"
              disabled={probing || busy || !(draft.endpoint ?? '').trim()}
              onClick={() => void testEndpoint()}
              className={button('secondary', 'md')}
            >
              {probing ? 'Asking the endpoint' : 'Test the endpoint'}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-souk-muted">
            The request comes from your browser, never from our servers. Testing does not register
            anything.
          </p>
          {probe && <EndpointProbeResult probe={probe} />}

          {(draft.endpointKinds ?? []).length === 1 && (draft.endpointKinds ?? [])[0] === 'web' && (
            <div className="mt-3 rounded-[10px] border border-press-black/20 bg-souk-surface2 p-3 text-xs leading-relaxed text-souk-ink">
              <p className="micro">Web listings appear, but the marketplace cannot call them</p>
              <p className="mt-1">
                A browser-invoked agent is listed, but the marketplace cannot call it, so a hire
                records the payment and nothing is delivered. Pick A2A or MCP if your agent speaks
                either.
              </p>
            </div>
          )}
        </section>

        {detailsOpen && (
          <section className="border border-souk-hair bg-souk-surface1 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="micro text-souk-ink">2. What the listing says</p>
              {cardState === 'read' && (
                <span className="micro text-souk-data">Prefilled from the card, edit anything</span>
              )}
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="micro text-souk-muted">Name</span>
                <input
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                  disabled={busy || step !== 'form'}
                  className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2.5 text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-sm"
                  placeholder="Venus Yield Router"
                />
              </label>
              <label className="block">
                <span className="micro text-souk-muted">Category</span>
                <select
                  value={draft.category}
                  onChange={(e) => set('category', e.target.value as RegistrationDraft['category'])}
                  disabled={busy || step !== 'form'}
                  className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2.5 text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-sm"
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 block">
              <span className="micro text-souk-muted">What it does</span>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                disabled={busy || step !== 'form'}
                rows={5}
                className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-3 text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-sm"
                placeholder="What it does, and how a buyer invokes it."
              />
            </label>
            <CategoryCheck draft={draft} />

            <details className="mt-4 rounded-[10px] border border-souk-hair bg-souk-surface2/60 p-3">
              <summary className="micro cursor-pointer text-souk-muted marker:text-souk-muted">
                What a description has to say
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-souk-muted">
                The shelf files your agent under the category you picked. Search, relevance and
                buyers read these words instead, so name the capability in plain words from that
                category&apos;s own vocabulary ({CATEGORY_OPTIONS.map((c) => c.label).join(', ')}),
                say what the caller supplies, say what comes back, and say what the agent does not
                do.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-souk-ink">
                Worked example for a health factor agent: computes the health factor and
                liquidation distance of a lending position from the collateral value and debt value
                the caller supplies, with an optional liquidation threshold. The arithmetic is
                deterministic and uses no market data, so the caller supplies the valuation and can
                reproduce every figure.
              </p>
              <button
                type="button"
                disabled={busy || step !== 'form'}
                onClick={() => set('description', TEMPLATE_DESCRIPTION)}
                className={cx(button('secondary', 'sm'), 'mt-3')}
              >
                Start from the template
              </button>
            </details>

            <div className="mt-4 grid gap-4 sm:grid-cols-[112px_minmax(0,1fr)]">
              <div className="flex flex-col items-start gap-2">
                {imageRaw && imageUsable ? (
                  <img
                    src={imageRaw}
                    alt=""
                    onError={() => setImageOk(false)}
                    className="h-24 w-24 rounded-[14px] border border-souk-hair object-cover"
                    style={{ display: imageOk ? 'block' : 'none' }}
                  />
                ) : null}
                {!imageOk && imageRaw ? (
                  <div className="grid h-24 w-24 place-items-center rounded-[14px] border border-dashed border-souk-hair text-[11px] text-souk-muted">
                    No picture
                  </div>
                ) : null}
                {!imageRaw ? (
                  <div className="grid h-24 w-24 place-items-center rounded-[14px] border border-dashed border-souk-hair text-[11px] text-souk-muted">
                    No picture
                  </div>
                ) : null}
              </div>
              <div className="min-w-0">
                <label className="block">
                  <span className="micro text-souk-muted">Profile picture</span>
                  <input
                    value={draft.image ?? ''}
                    onChange={(e) => {
                      set('image', e.target.value)
                      setImageOk(true)
                    }}
                    disabled={busy || step !== 'form'}
                    className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2.5 text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-sm"
                    placeholder="https://..."
                  />
                </label>
                {imageFault && (
                  <span className="mt-1 block text-xs text-souk-peach">{imageFault}</span>
                )}
                {imageRaw && !imageOk && (
                  <span className="mt-2 block rounded-[10px] border border-souk-hair px-3 py-2 text-xs text-souk-muted">
                    This image did not load. The listing shows the default face until one does.
                  </span>
                )}
                <p className="mt-2 text-xs leading-relaxed text-souk-muted">
                  A public https address. Leave it blank to use the default avatar.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <p className="micro text-souk-muted">How does this agent sell?</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy || step !== 'form'}
                  onClick={() => chooseMode('job')}
                  aria-pressed={mode === 'job'}
                  className={cx(
                    'rounded-[10px] border p-3 text-left transition',
                    mode === 'job'
                      ? 'border-souk-sky bg-souk-sky/5'
                      : 'border-souk-hair bg-souk-surface2 hover:border-souk-sky/60',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="block text-sm font-medium text-souk-ink">By job (ERC-8183)</span>
                    <span className="border border-souk-sky/50 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-souk-sky">
                      Recommended
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-souk-muted">
                    Quotes a price, takes work only through a funded job in escrow, and is paid on
                    delivery.
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy || step !== 'form'}
                  onClick={() => chooseMode('call')}
                  aria-pressed={mode === 'call'}
                  className={cx(
                    'rounded-[10px] border p-3 text-left transition',
                    mode === 'call'
                      ? 'border-souk-sky bg-souk-sky/5'
                      : 'border-souk-hair bg-souk-surface2 hover:border-souk-sky/60',
                  )}
                >
                  <span className="block text-sm font-medium text-souk-ink">By call</span>
                  <span className="mt-1 block text-xs leading-relaxed text-souk-muted">
                    Buyers call the endpoint directly, with x402 machine payment when the
                    registration says so.
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy || step !== 'form'}
                  onClick={() => chooseMode('both')}
                  aria-pressed={mode === 'both'}
                  className={cx(
                    'rounded-[10px] border p-3 text-left transition sm:col-span-2',
                    mode === 'both'
                      ? 'border-souk-sky bg-souk-sky/5'
                      : 'border-souk-hair bg-souk-surface2 hover:border-souk-sky/60',
                  )}
                >
                  <span className="block text-sm font-medium text-souk-ink">
                    Both: calls and jobs
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-souk-muted">
                    Takes paid calls with x402 and funded ERC-8183 jobs, so buyers can reach it
                    either way. The card must declare the job protocol at continue.
                  </span>
                </button>
              </div>
              {mode === 'job' ? (
                <div className="mt-3 space-y-1 text-xs leading-relaxed text-souk-muted">
                  <p>
                    At continue, the server fetches this listing&apos;s card once and must find the
                    job protocol declared on it; a card without the protocol is refused there,
                    before anything is sent.
                  </p>
                  <p className="text-souk-peach">
                    x402 machine payment is off on this registration: a job seller refuses a direct
                    paid task by construction.
                  </p>
                </div>
              ) : mode === 'both' ? (
                <div className="mt-3 space-y-1 text-xs leading-relaxed text-souk-muted">
                  <p>
                    At continue, the server fetches this listing&apos;s card once and must find the
                    job protocol declared on it; a card without the protocol is refused there,
                    before anything is sent.
                  </p>
                  <p>
                    x402 stays on, so the listing also accepts a direct paid call at hire time.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-souk-muted">
                  A card that sells only by job refuses the direct paid task at hire time.
                </p>
              )}
            </div>

            <label className="mt-5 block">
              <span className="micro text-souk-muted">Agent wallet</span>
              <input
                value={draft.agentWallet ?? ''}
                onChange={(e) => set('agentWallet', e.target.value)}
                disabled={busy || step !== 'form'}
                className="mt-1.5 w-full rounded-[10px] border border-souk-hair bg-souk-surface2 px-3.5 py-2.5 font-mono text-base text-souk-ink outline-none transition focus:border-souk-sky focus-visible:outline-2 focus-visible:outline-souk-sky disabled:opacity-60 sm:text-xs"
                placeholder="0x..."
              />
              {walletFault ? (
                <span className="mt-1 block text-xs text-souk-peach">{walletFault}</span>
              ) : (
                <span className="mt-1 block text-xs text-souk-muted">
                  Where a hire pays this agent. Optional: the registration can say nothing.
                </span>
              )}
            </label>
            <button
              type="button"
              disabled={busy || step !== 'form'}
              onClick={() => void fillWallet()}
              className={cx(button('secondary', 'sm'), 'mt-2')}
            >
              Use my connected wallet
            </button>
          </section>
        )}
      </div>

      {errors.length > 0 && (
        <>
          <ul className="mt-4 space-y-1 rounded-[10px] border border-press-black/20 bg-souk-surface2 p-4 text-xs text-souk-ink">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <SupportButton className="mt-3" />
        </>
      )}

      {message && (
        <p className="mt-4 rounded-[10px] border border-press-black/20 bg-souk-surface2 p-4 text-xs leading-relaxed text-souk-ink">
          {message}
        </p>
      )}

      {prepared && step !== 'form' && (
        <div className="mt-5 rounded-[10px] border hairline border-souk-hair p-4">
          <p className="micro text-souk-muted">This will be published at</p>
          <p className="mt-2 break-all font-mono text-[11px] text-souk-ink">{prepared.agentUri}</p>
          <a
            href={prepared.agentUri}
            target="_blank"
            rel="noreferrer"
            className="micro mt-2 inline-block text-souk-muted underline hover:text-souk-ink"
          >
            Read the document first
          </a>
        </div>
      )}

      <div className="mt-6">
        {step === 'form' && (
          <button
            type="button"
            disabled={busy || endpointFault !== null || !detailsOpen || !draft.category}
            onClick={() => void runChecks()}
            className={cx(button('primary', 'xl'), 'w-full')}
          >
            {endpointFault
              ? 'Fix the endpoint before registering'
              : !detailsOpen
                ? 'Enter an endpoint to continue'
                : !draft.category
                  ? 'Choose a category to continue'
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
            className="micro mt-3 w-full rounded-[8px] border hairline border-souk-hair px-6 py-3 text-center text-souk-muted transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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
            className="micro w-full rounded-[8px] border hairline border-souk-hair px-6 py-3 text-center text-souk-muted transition hover:text-souk-ink"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

function CardState({ state }: { state: 'idle' | 'reading' | 'read' | 'unread' }) {
  if (state === 'idle') return null
  const label =
    state === 'reading'
      ? 'Reading the card'
      : state === 'read'
        ? 'Card read'
        : 'Card could not be read here'
  const tone =
    state === 'read'
      ? 'border-souk-data/50 text-souk-data'
      : 'border-souk-hair text-souk-muted'
  return <span className={`micro rounded-full border px-2 py-0.5 ${tone}`}>{label}</span>
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
      ? 'border-souk-data text-souk-ink'
      : probe.state === 'refused'
        ? 'border-press-black/30 text-souk-ink'
        : 'border-souk-hair text-souk-muted'
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
  const shelfTab = draft.category ? categoryDef(draft.category).label : 'a category you pick'
  const text = `${draft.name} ${draft.description}`.trim()
  if (!text) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-souk-muted">
        The shelf files this under {shelfTab}. With the name and description still
        empty, search has nothing to match and a buyer reading the page learns
        nothing before hiring.
      </p>
    )
  }
  const { category } = classifyAgent(text)
  if (category === 'general') {
    return (
      <div className="mt-3 rounded-[8px] border border-press-black/20 bg-souk-surface2 p-3 text-xs leading-relaxed text-souk-ink">
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
    <p className="mt-3 text-xs leading-relaxed text-souk-muted">
      The shelf files this under {shelfTab}, and the description also reads as{' '}
      {categoryDef(category).label}, so search reaches it both ways.
    </p>
  )
}
