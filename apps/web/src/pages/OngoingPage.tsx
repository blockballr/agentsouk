import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  actOnJob,
  getEscrowStatuses,
  getHiresByWallet,
  getOngoing,
  retryTask,
  type EscrowStatus,
  type OngoingBundle,
} from '../lib/api'
import { timeAgo } from '@agora/core'
import { explorerTxBase } from '../lib/contracts'
import { mergeSessions, stabiliseSessions } from '../lib/ongoing-merge'
import {
  escrowChip,
  escrowRejectMove,
  hireItems,
  hireState,
  readableResult,
  type EscrowChip,
  type HireGroup,
  type HireItem,
  type HireState,
} from '../lib/hire-state'
import { hireErrorText } from '../lib/hire'
import { chainIdToHex, connectWallet, ensureBscChain, getActiveAccount, getProvider, setTargetChain } from '../lib/wallet'
import { encodeFunctionData, keccak256, toBytes } from 'viem'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { ratedHires } from '../lib/rating'
import { RateAgent } from '../components/RateAgent'
import { Action, Dialog, LABEL, RatingBoxes, ResultBox, TextSlot, button, card, cx } from '../components/ui'
import { revokeSessionWithCancel, type RevokeOutcome } from '../lib/sessions'

// the server holds each wallet's view for five seconds, so a faster poll only
// re-reads the same answer
const POLL_MS = 5000

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m left`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${mins % 60}m left`
  return new Date(iso).toLocaleString()
}

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function OngoingPage() {
  const [account, setAccount] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [data, setData] = useState<OngoingBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [jobBusy, setJobBusy] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokeResults, setRevokeResults] = useState<Record<string, RevokeOutcome>>({})
  const [escrowById, setEscrowById] = useState<Record<string, EscrowStatus>>({})
  const [escrowFunder, setEscrowFunder] = useState<string | null>(null)
  const [escrowBusyId, setEscrowBusyId] = useState<string | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    void getActiveAccount().then((a) => setAccount(a))
  }, [])

  const load = useCallback(async () => {
    if (!account) {
      setData(null)
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    try {
      // The instance ledger may be cold or belong to another instance, so the
      // wallet's durable hires are fetched alongside it and merged by payment id.
      const [bundle, hires] = await Promise.allSettled([
        getOngoing(account),
        getHiresByWallet(account),
      ])
      const walletHires = hires.status === 'fulfilled' ? hires.value : []
      if (bundle.status === 'fulfilled') {
        const merged = mergeSessions(bundle.value.sessions, walletHires)
        setData((prev) => ({ ...bundle.value, sessions: stabiliseSessions(prev?.sessions, merged) }))
        setError(null)
        return
      }
      if (hires.status === 'fulfilled') {
        // The ledger is unavailable but the wallet's own hires still stand. Counts
        // are left absent rather than reported as zero.
        const merged = mergeSessions([], walletHires)
        setData((prev) => ({ sessions: stabiliseSessions(prev?.sessions, merged), recentTasks: [] }))
        setError(null)
        return
      }
      setError(hireErrorText(bundle.reason))
    } finally {
      inFlight.current = false
    }
  }, [account])

  // a hidden tab stops polling and catches up the moment it is shown again
  useEffect(() => {
    void load()
    if (!account) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void load()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, account])

  // the escrow line is a chain read, not part of the five second poll: it is
  // asked when the set of hires changes, then once a minute, so a release
  // landing from the cron still reaches the card without hammering the RPC
  const escrowKey = data ? hireItems(data).map((i) => i.key).sort().join(',') : ''
  useEffect(() => {
    if (!escrowKey) {
      setEscrowById({})
      setEscrowFunder(null)
      return
    }
    let alive = true
    const ids = escrowKey.split(',')
    const pull = () => {
      void getEscrowStatuses(ids).then((r) => {
        if (!alive) return
        setEscrowById(r.byId)
        setEscrowFunder(r.funder)
      })
    }
    pull()
    const id = window.setInterval(pull, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [escrowKey])

  async function onConnect() {
    setConnecting(true)
    try {
      const addr = await connectWallet()
      setAccount(addr)
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  async function onRetry(taskId: string) {
    setRetryingId(taskId)
    try {
      await retryTask(taskId)
      await load()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setRetryingId(null)
    }
  }

  async function onJob(jobId: string, action: 'complete' | 'reject' | 'claimRefund') {
    if (!account) return
    setJobBusy(jobId)
    try {
      await actOnJob(jobId, action, { by: account, reason: action })
      await load()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setJobBusy(null)
    }
  }

  async function onRevoke(paymentId: string) {
    if (!account) return
    setRevokingId(paymentId)
    try {
      const outcome = await revokeSessionWithCancel(paymentId, account)
      if (outcome) setRevokeResults((prev) => ({ ...prev, [paymentId]: outcome }))
      await load()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setRevokingId(null)
    }
  }

  // Release, refund and dispute are the buyer's own calls on the funder
  // contract, sent from the wallet rather than through the marketplace: the
  // contract decides by msg.sender, and the job id is the keccak of the
  // payment id. Throwing here is the caller's error to show
  async function sendEscrowTx(paymentId: string, chainId: number, kind: 'approve' | 'refund' | 'reject') {
    if (!account) throw new Error('Connect the wallet that paid for this hire.')
    if (!escrowFunder) throw new Error('This deployment has no escrow contract to call.')
    const provider = await getProvider()
    setTargetChain(chainId)
    const chain = await ensureBscChain()
    if (chain?.toLowerCase() !== chainIdToHex(chainId)) {
      throw new Error(`Switch your wallet to ${chainId === 97 ? 'BSC testnet' : 'BSC'} to settle escrow on it.`)
    }
    const data = encodeFunctionData({
      abi: FUNDER_ACTIONS,
      functionName: kind,
      args: [keccak256(toBytes(paymentId))],
    })
    const txHash = (await withSendTimeout(
      provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: escrowFunder, data }] }),
    )) as `0x${string}`
    const receipt = await waitForTransactionReceipt(() =>
      provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] }) as Promise<TransactionReceipt | null>,
    )
    if (receipt && !(receipt.status === '0x1' || receipt.status === 'success')) {
      throw new Error('The escrow transaction reverted. Nothing moved.')
    }
  }

  async function onEscrow(paymentId: string, chainId: number, kind: 'approve' | 'refund') {
    if (!account || !escrowFunder) return
    setEscrowBusyId(paymentId)
    try {
      await sendEscrowTx(paymentId, chainId, kind)
      const refreshed = await getEscrowStatuses([paymentId])
      setEscrowById((prev) => ({ ...prev, ...refreshed.byId }))
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setEscrowBusyId(null)
    }
  }

  // Rejecting an escrowed hire moves the money back before the record changes:
  // the refund before any verified delivery, the dispute inside the window
  // after one, and a refusal with the reason once the chain says no. The
  // on-chain call goes first, so a failed wallet call never leaves a job
  // reading rejected while the escrow still holds the payment
  async function onJobReject(item: HireItem) {
    if (!account) return
    const jobId = item.job?.id
    if (!jobId) return
    const move = escrowRejectMove(item.escrow)
    if (move.kind === 'refuse') {
      setError(move.reason ?? 'This escrow can no longer be rejected.')
      return
    }
    setJobBusy(jobId)
    try {
      if (move.kind !== 'plain') {
        if (account.toLowerCase() !== (item.escrow?.buyer ?? '').toLowerCase()) {
          throw new Error('Only the wallet that paid can dispute this escrow.')
        }
        await sendEscrowTx(item.key, item.chainId, move.kind)
        const refreshed = await getEscrowStatuses([item.key])
        setEscrowById((prev) => ({ ...prev, ...refreshed.byId }))
      }
      await actOnJob(jobId, 'reject', { by: account, reason: 'reject' })
      await load()
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setJobBusy(null)
    }
  }

  const items = hireItems(data).map((i) => ({ ...i, escrow: escrowById[i.key] ?? null }))
  const groups: { key: HireGroup; title: string; empty?: string }[] = [
    { key: 'needs', title: 'Needs you' },
    { key: 'progress', title: 'In progress' },
    { key: 'finished', title: 'Finished' },
  ]
  // within a group the most pressing action leads: an OK to give, then a retry, then a first run
  const ACTION_ORDER = { complete: 0, retry: 1, run: 2 } as const
  const byGroup = (g: HireGroup) =>
    items
      .filter((i) => hireState(i).group === g)
      .sort((a, b) => {
        const x = hireState(a).action
        const y = hireState(b).action
        return (x ? ACTION_ORDER[x] : 3) - (y ? ACTION_ORDER[y] : 3)
      })
  const shownKeys = new Set(items.map((i) => i.key))
  const standaloneRevocations = Object.entries(revokeResults).filter(([paymentId]) => !shownKeys.has(paymentId))

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Ongoing</p>
      <h1 className="mt-4 font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Your hires.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Everything this wallet has hired. Anything waiting on you comes first.
      </p>

      {!account && (
        <div className="mt-10 metal rounded-[14px] border hairline border-slate-verdant/40 p-8 sm:p-10">
          <p className="text-[15px] text-press-black">Connect the wallet you hired with.</p>
          <p className="mt-2 text-[13px] text-newsprint-gray">Hires are kept per wallet, so this is how we find yours.</p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="gloss micro mt-6 rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        </div>
      )}

      {account && (
        <p className="mt-6 text-[13px] text-newsprint-gray">
          <span className="font-mono text-press-black">{shortAddr(account)}</span>
          {groups.map((g) => {
            const n = byGroup(g.key).length
            if (n === 0) return ''
            return g.key === 'needs' ? ` · ${n} ${n === 1 ? 'needs' : 'need'} you` : ` · ${n} ${g.title.toLowerCase()}`
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-[13px] text-press-black">
          {error}
        </p>
      )}

      {account && data && items.length === 0 && !error && (
        <div className="mt-10 metal rounded-[14px] border hairline border-slate-verdant/40 p-8 sm:p-10">
          <p className="text-[15px] text-press-black">Nothing hired with this wallet yet.</p>
          <p className="mt-2 text-[13px] text-newsprint-gray">Hire an agent and it shows up here while you use it.</p>
          <Link
            to="/agents"
            className="gloss micro mt-6 inline-block rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95"
          >
            Browse agents
          </Link>
        </div>
      )}

      {account &&
        groups.map((g) => {
          const list = byGroup(g.key)
          if (list.length === 0) return null
          return (
            <div key={g.key} className="mt-12">
              <h2 className="micro text-newsprint-gray">
                {g.title} · {list.length}
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((it) => (
                  <HireRow
                    key={it.key}
                    item={it}
                    state={hireState(it)}
                    busy={jobBusy === it.job?.id || retryingId === it.task?.id || revokingId === it.key}
                    revoking={revokingId === it.key}
                    revoke={revokeResults[it.key]}
                    account={account}
                    escrowBusy={escrowBusyId === it.key}
                    onComplete={() => it.job && onJob(it.job.id, 'complete')}
                    onReject={() => onJobReject(it)}
                    onRetry={() => it.task && onRetry(it.task.id)}
                    onRevoke={() => onRevoke(it.key)}
                    onEscrow={(kind) => onEscrow(it.key, it.chainId, kind)}
                  />
                ))}
              </div>
            </div>
          )
        })}

      {account && standaloneRevocations.length > 0 && (
        <div className="mt-12">
          <h2 className="micro text-newsprint-gray">Revoked</h2>
          <div className="mt-3 space-y-2">
            {standaloneRevocations.map(([paymentId, outcome]) => (
              <div key={paymentId} className="rounded-[10px] border hairline border-slate-verdant/30 p-4">
                <RevokeNote outcome={outcome} chainId={outcome.chainId ?? 0} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

const STATE_DOT: Record<HireGroup, string> = {
  needs: 'glow bg-highlighter-green',
  progress: 'glow bg-highlighter-green motion-safe:animate-pulse',
  finished: 'border hairline border-newsprint-gray bg-transparent',
}

// the escrow line's dot: money held, money ready to move, money moved
const ESCROW_DOT: Record<EscrowChip['tone'], string> = {
  hold: 'bg-amber-500',
  ready: 'bg-sky-500',
  done: 'bg-emerald-500',
}

// the funder's three buyer verbs, sent from the wallet rather than relayed
const FUNDER_ACTIONS = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
  { name: 'refund', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
  { name: 'reject', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'jobId', type: 'bytes32' }], outputs: [] },
] as const

// every hire is built from the same parts in the same order at a fixed height, so a row of
// cards reads evenly, and anything longer than its slot opens in a dialog instead
function HireRow({
  item,
  state,
  busy,
  revoking,
  revoke,
  account,
  escrowBusy,
  onComplete,
  onReject,
  onRetry,
  onRevoke,
  onEscrow,
}: {
  item: HireItem
  state: HireState
  busy: boolean
  revoking: boolean
  revoke?: RevokeOutcome
  account: string | null
  escrowBusy: boolean
  onComplete: () => void
  onReject: () => void
  onRetry: () => void
  onRevoke: () => void
  onEscrow: (kind: 'approve' | 'refund') => void
}) {
  const { session, task, job } = item
  const escrowRow = item.escrow ?? null
  const chip = escrowChip(escrowRow)
  const isBuyer = Boolean(account && escrowRow && account.toLowerCase() === escrowRow.buyer.toLowerCase())
  const windowLeft =
    escrowRow &&
    escrowRow.status === 0 &&
    escrowRow.verifiedAt > 0 &&
    escrowRow.windowEndsAt !== null &&
    escrowRow.windowEndsAt * 1000 > Date.now()
      ? ` · ${formatExpiry(new Date(escrowRow.windowEndsAt * 1000).toISOString())}`
      : ''
  const agentHref = `/agents/${item.chainId}/${item.tokenId}`
  const asked = task?.taskText ?? task?.tool
  // a hire with a job is rated once the buyer completes it; one without a job ends at delivery
  const rateable = job ? job.status === 'Completed' : task?.status === 'delivered'
  // undefined until rated; a number is the rating given, null one saved before ratings were kept
  const [rated, setRated] = useState<number | null | undefined>(() => ratedHires().get(item.key))
  const [dialog, setDialog] = useState<'full' | 'rate' | 'revoke' | null>(null)
  const shown = answerOf(task?.result ?? job?.deliverable ?? null, task?.error ?? null)
  const meta = [
    item.live && session
      ? `${formatExpiry(session.expiresAt)} · $${session.spendCapUsd} cap`
      : session
        ? // a track record needs its dates: the window the hire ran in, so a
          // finished card reads as history rather than a place to park it
          `${timeAgo(session.createdAt)} to ${timeAgo(session.expiresAt)}`
        : 'Session ended',
    session?.mode === 'sandbox' ? 'test settlement' : null,
    job ? `$${job.budgetUsd} job` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <article className={cx(card(state.group === 'needs' ? 'strong' : 'plain', 'sm'), 'flex h-[520px] min-w-0 flex-col [overflow-wrap:anywhere]')}>
      <div className="flex items-start justify-between gap-3">
        <Link to={agentHref} className="min-w-0 truncate font-serif text-[22px] leading-tight text-press-black hover:underline">
          {item.agentName}
        </Link>
        {/* the buyer's control over a live session, so it is the plainest button on the card; an
            ended session has nothing left to spend and shows none */}
        {item.live && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className={cx(button('secondary', 'sm'), 'shrink-0 border-press-black/70 hover:bg-press-black hover:text-bone-white')}
          >
            {revoking ? 'Revoking…' : 'Revoke session'}
          </button>
        )}
      </div>
      <p className="mt-1 flex items-center gap-2 text-[14px] font-medium text-press-black">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[state.group]}`} />
        <span className="truncate">{state.label}</span>
      </p>
      {/* the money's own line: held, ready or moved, so the card never reads as
          paid out while the funder still holds the payment */}
      {chip && (
        <p className="mt-1 flex items-center gap-2 text-[13px] text-newsprint-gray">
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${ESCROW_DOT[chip.tone]}`} />
          <span className="truncate">
            {chip.text}
            {windowLeft}
          </span>
        </p>
      )}
      <TextSlot lines={2} className="mt-1">{state.note ?? ''}</TextSlot>
      <TextSlot lines={1} className="mt-1 text-[12px]">{meta}</TextSlot>
      <TextSlot lines={2} className="mt-3">
        {asked ? (
          <>
            You asked: <span className="text-press-black">{asked}</span>
          </>
        ) : (
          'No task sent yet.'
        )}
      </TextSlot>

      <ResultBox
        className="mt-3 flex-1"
        label={shown.label}
        preview={shown.preview}
        moreLabel={shown.full ? `View full ${shown.label === 'Result' ? 'result' : 'reply'}` : undefined}
        onMore={shown.full ? () => setDialog('full') : undefined}
      />

      {/* the actions in an even two-column grid, then the rating on its own line; the result box
          above takes whatever height is left, which always holds its four lines */}
      <div className="mt-3 flex shrink-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 empty:hidden">
          {state.action === 'complete' && (
            <>
              <Action variant="primary" onClick={onComplete} disabled={busy} className="w-full">
                Complete job
              </Action>
              <Action onClick={onReject} disabled={busy} className="w-full">
                Reject
              </Action>
            </>
          )}
          {state.action === 'retry' && (
            <Action variant="primary" onClick={onRetry} disabled={busy} className="w-full">
              Retry delivery
            </Action>
          )}
          {state.action === 'run' ? (
            <Action variant="primary" to={agentHref} className="w-full">
              Run a task
            </Action>
          ) : item.live ? (
            <Action to={agentHref} className="w-full">
              Open agent
            </Action>
          ) : null}
          {item.live && job?.status === 'Funded' && task?.status !== 'running' && !task?.result && (
            <Action onClick={onReject} disabled={busy} className="w-full">
              Reject before work
            </Action>
          )}
          {rateable && rated === undefined && (
            <Action onClick={() => setDialog('rate')} className="w-full">
              Rate agent
            </Action>
          )}
          {revoke && (
            <Action onClick={() => setDialog('revoke')} className="w-full">
              Revoke details
            </Action>
          )}
        </div>
        {/* the buyer's own money moves: release pays the agent now, refund takes
            the payment back while no verified delivery exists yet */}
        {escrowRow?.status === 0 && isBuyer && (
          <div className="flex gap-2">
            <Action
              variant="primary"
              onClick={() => onEscrow('approve')}
              disabled={busy || escrowBusy}
              className="flex-1"
            >
              Release now
            </Action>
            {escrowRow.verifiedAt === 0 && (
              <Action onClick={() => onEscrow('refund')} disabled={busy || escrowBusy} className="flex-1">
                Refund
              </Action>
            )}
          </div>
        )}
        {rateable && rated !== undefined && (
          <div className="flex h-7 items-center gap-3">
            <span className={LABEL}>Rated</span>
            <RatingBoxes value={rated} label={rated ? `Rated ${rated} of 5` : 'Rated'} />
          </div>
        )}
      </div>

      {dialog === 'full' && shown.full ? (
        <Dialog title={`${item.agentName} · ${shown.label}`} onClose={() => setDialog(null)}>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-press-black">{shown.full}</pre>
        </Dialog>
      ) : null}
      {dialog === 'rate' ? (
        <Dialog title={`Rate ${item.agentName}`} onClose={() => setDialog(null)}>
          <RateAgent
            chainId={item.chainId}
            tokenId={item.tokenId}
            agentName={item.agentName}
            paymentId={item.key}
            onRated={setRated}
          />
        </Dialog>
      ) : null}
      {dialog === 'revoke' && revoke ? (
        <Dialog title={`${item.agentName} · revoke`} onClose={() => setDialog(null)}>
          <RevokeNote outcome={revoke} chainId={item.chainId} />
        </Dialog>
      ) : null}
    </article>
  )
}

interface Answer {
  label: string
  preview: string
  full: string | null
}

// a reply carrying an error is labelled as the agent's, not as a result
function answerOf(result: string | null, reply: string | null): Answer {
  const text = result ?? reply
  if (!text) return { label: 'Result', preview: 'No result yet.', full: null }
  const r = readableResult(text)
  const erred = r.kind === 'fields' && r.fields.some(([k]) => /^error$/i.test(k))
  const label = !result || erred ? 'Agent replied' : 'Result'
  const preview = r.kind === 'fields' ? r.fields.map(([k, v]) => `${k}: ${v}`).join(' · ') : r.text
  return { label, preview, full: text }
}

function RevokeNote({ outcome, chainId }: { outcome: RevokeOutcome; chainId: number }) {
  if (outcome.txHash) {
    const href = outcome.txLink ?? `${explorerTxBase(outcome.chainId ?? chainId)}/tx/${outcome.txHash}`
    return (
      <p className="micro mt-2 text-newsprint-gray">
        Authorization cancelled on chain ·{' '}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-press-black underline"
        >
          {outcome.txHash.slice(0, 18)}…
        </a>
      </p>
    )
  }
  if (outcome.alreadyRevoked) {
    return (
      <p className="micro mt-2 text-newsprint-gray">
        Authorization was already cancelled on chain.
      </p>
    )
  }
  return (
    <p className="micro mt-2 text-newsprint-gray">
      Revoked in the ledger. Authorization not cancelled on chain
      {outcome.error ? `: ${outcome.error}` : '.'}
    </p>
  )
}
