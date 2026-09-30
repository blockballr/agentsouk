import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  actOnJob,
  getHiresByWallet,
  getOngoing,
  retryTask,
  type OngoingBundle,
} from '../lib/api'
import { explorerTxBase } from '../lib/contracts'
import { mergeSessions, stabiliseSessions } from '../lib/ongoing-merge'
import { hireItems, hireState, readableResult, type HireGroup, type HireItem, type HireState } from '../lib/hire-state'
import { hireErrorText } from '../lib/hire'
import { connectWallet, getActiveAccount, getProvider } from '../lib/wallet'
import { ratedHires } from '../lib/rating'
import { RateAgent } from '../components/RateAgent'
import { revokeRequestMessage } from '@agora/core'

interface RevokeOutcome {
  attempted: boolean
  canceled: boolean
  alreadyRevoked?: boolean
  txHash?: string
  chainId?: number
  txLink?: string
  error?: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

// the server holds each wallet's view for five seconds, so a faster poll only
// re-reads the same answer
const POLL_MS = 5000

// The revoke response carries the on-chain cancellation result, which api.ts's
// revokeSession discards, so call the endpoint directly to keep the transaction hash.
async function revokeSessionWithCancel(
  paymentId: string,
  client: string,
): Promise<RevokeOutcome | null> {
  // the buyer signs a message, not a transaction, so nobody who only knows the
  // paymentId can revoke the session
  const provider = await getProvider()
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [revokeRequestMessage(paymentId, client), client],
  })) as string
  const res = await fetch(`${API_BASE}/sessions?paymentId=${encodeURIComponent(paymentId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client, signature }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `revoke ${res.status}`)
  return (body.onchain as RevokeOutcome | undefined) ?? null
}

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

  const items = hireItems(data)
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
    <section className="mx-auto max-w-[1100px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Ongoing</p>
      <h1 className="mt-4 font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Your hires.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Everything this wallet has hired. Anything waiting on you comes first.
      </p>

      {!account && (
        <div className="mt-10 rounded-[14px] border hairline border-slate-verdant/40 p-8 sm:p-10">
          <p className="text-[15px] text-press-black">Connect the wallet you hired with.</p>
          <p className="mt-2 text-[13px] text-newsprint-gray">Hires are kept per wallet, so this is how we find yours.</p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="micro mt-6 rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 disabled:opacity-60"
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
        <div className="mt-10 rounded-[14px] border hairline border-slate-verdant/40 p-8 sm:p-10">
          <p className="text-[15px] text-press-black">Nothing hired with this wallet yet.</p>
          <p className="mt-2 text-[13px] text-newsprint-gray">Hire an agent and it shows up here while you use it.</p>
          <Link
            to="/agents"
            className="micro mt-6 inline-block rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95"
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
              <div className="mt-4 space-y-4">
                {list.map((it) => (
                  <HireRow
                    key={it.key}
                    item={it}
                    state={hireState(it)}
                    busy={jobBusy === it.job?.id || retryingId === it.task?.id || revokingId === it.key}
                    revoking={revokingId === it.key}
                    revoke={revokeResults[it.key]}
                    onComplete={() => it.job && onJob(it.job.id, 'complete')}
                    onReject={() => it.job && onJob(it.job.id, 'reject')}
                    onRetry={() => it.task && onRetry(it.task.id)}
                    onRevoke={() => onRevoke(it.key)}
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
  needs: 'bg-highlighter-green',
  progress: 'bg-highlighter-green motion-safe:animate-pulse',
  finished: 'border hairline border-newsprint-gray bg-transparent',
}

function HireRow({
  item,
  state,
  busy,
  revoking,
  revoke,
  onComplete,
  onReject,
  onRetry,
  onRevoke,
}: {
  item: HireItem
  state: HireState
  busy: boolean
  revoking: boolean
  revoke?: RevokeOutcome
  onComplete: () => void
  onReject: () => void
  onRetry: () => void
  onRevoke: () => void
}) {
  const { session, task, job } = item
  const agentHref = `/agents/${item.chainId}/${item.tokenId}`
  const asked = task?.taskText ?? task?.tool
  // a rating needs work to rate: a delivered task or a job the buyer completed
  const rateable = task?.status === 'delivered' || job?.status === 'Completed'
  const [rating, setRating] = useState(false)
  const [rated] = useState(() => ratedHires().has(item.key))
  const primary =
    'micro rounded-[5px] bg-highlighter-green px-4 py-2.5 text-on-highlighter shadow-sm transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:opacity-60'
  const secondary =
    'micro rounded-[5px] border hairline border-slate-verdant/50 px-4 py-2.5 text-press-black transition hover:border-press-black focus-visible:outline-2 focus-visible:outline-press-black disabled:opacity-60'
  return (
    <article
      className={`rounded-[14px] border hairline p-5 sm:p-6 ${
        state.group === 'needs' ? 'border-press-black/35' : 'border-slate-verdant/35'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <Link to={agentHref} className="font-serif text-[24px] leading-tight text-press-black hover:underline">
            {item.agentName}
          </Link>
          <p className="mt-1 flex items-center gap-2 text-[14px] font-medium text-press-black">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[state.group]}`} />
            {state.label}
          </p>
          {state.note ? <p className="mt-1 text-[13px] text-newsprint-gray">{state.note}</p> : null}
        </div>
        <p className="text-[13px] text-newsprint-gray sm:text-right">
          {item.live && session ? `${formatExpiry(session.expiresAt)} · $${session.spendCapUsd} cap` : 'Session ended'}
          {session?.mode === 'sandbox' ? ' · test settlement' : ''}
          {job ? <span className="block">Job budget ${job.budgetUsd}</span> : null}
        </p>
      </div>

      {asked ? (
        <p className="mt-4 text-[13px] text-newsprint-gray">
          You asked: <span className="text-press-black">{asked.length > 160 ? `${asked.slice(0, 160)}…` : asked}</span>
        </p>
      ) : null}
      {task?.error ? (
        <p className="mt-2 text-[13px] leading-relaxed text-press-black">{task.error}</p>
      ) : null}
      {task?.result || job?.deliverable ? <ResultView text={task?.result ?? job?.deliverable ?? ''} /> : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {state.action === 'complete' && (
          <>
            <button type="button" onClick={onComplete} disabled={busy} className={primary}>
              Complete job
            </button>
            <button type="button" onClick={onReject} disabled={busy} className={secondary}>
              Reject
            </button>
          </>
        )}
        {state.action === 'retry' && (
          <button type="button" onClick={onRetry} disabled={busy} className={primary}>
            Retry delivery
          </button>
        )}
        {state.action === 'run' ? (
          <Link to={agentHref} className={primary}>
            Run a task
          </Link>
        ) : item.live ? (
          <Link to={agentHref} className={secondary}>
            Open agent
          </Link>
        ) : null}
        {job?.status === 'Funded' && task?.status !== 'running' && !task?.result && (
          <button type="button" onClick={onReject} disabled={busy} className={secondary}>
            Reject before work
          </button>
        )}
        {rateable && !rated && !rating && (
          <button type="button" onClick={() => setRating(true)} className={secondary}>
            Rate agent
          </button>
        )}
        {rateable && rated && <span className="micro text-newsprint-gray">Rated</span>}
        {/* only a live session can be revoked; an ended one has nothing left to spend */}
        {item.live && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="micro ml-auto px-1 py-2.5 text-newsprint-gray underline decoration-newsprint-gray/40 underline-offset-4 transition hover:text-press-black disabled:opacity-60"
          >
            {revoking ? 'Revoking…' : 'Revoke session'}
          </button>
        )}
      </div>
      {rating ? (
        <RateAgent chainId={item.chainId} tokenId={item.tokenId} agentName={item.agentName} paymentId={item.key} />
      ) : null}
      {revoke ? <RevokeNote outcome={revoke} chainId={item.chainId} /> : null}
    </article>
  )
}

function ResultView({ text }: { text: string }) {
  const r = readableResult(text)
  return (
    <div className="mt-4 rounded-[10px] bg-echo-green/30 p-4">
      <p className="micro text-newsprint-gray">Result</p>
      {r.kind === 'fields' ? (
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-[max-content_1fr]">
          {r.fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-newsprint-gray">{k}</dt>
              <dd className="break-words text-press-black">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-press-black">
          {r.text.length > 600 ? `${r.text.slice(0, 600)}…` : r.text}
        </p>
      )}
      {r.kind === 'fields' || text.length > 600 ? (
        <details className="mt-2">
          <summary className="micro cursor-pointer text-newsprint-gray hover:text-press-black">Full result</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-[8px] border hairline border-slate-verdant/30 bg-bone-white p-3 font-mono text-[11px] leading-relaxed text-press-black">
            {text}
          </pre>
        </details>
      ) : null}
    </div>
  )
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
