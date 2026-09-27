import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  actOnJob,
  getOngoing,
  retryTask,
  type ActiveHireSession,
  type Erc8183Job,
  type HireTask,
  type OngoingBundle,
} from '../lib/api'
import { explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { connectWallet, getActiveAccount } from '../lib/wallet'

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

// The revoke response carries the on-chain cancellation result, which api.ts's
// revokeSession discards, so call the endpoint directly to keep the transaction hash.
async function revokeSessionWithCancel(
  paymentId: string,
  client: string,
): Promise<RevokeOutcome | null> {
  const qs = `?paymentId=${encodeURIComponent(paymentId)}&client=${encodeURIComponent(client)}`
  const res = await fetch(`${API_BASE}/sessions${qs}`, { method: 'DELETE' })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `revoke ${res.status}`)
  return (body.onchain as RevokeOutcome | undefined) ?? null
}

const taskChip: Record<HireTask['status'], string> = {
  ready: 'border-slate-verdant/50 text-newsprint-gray',
  running: 'border-highlighter-green/50 text-highlighter-green',
  delivered: 'border-highlighter-green/50 text-highlighter-green',
  failed: 'border-press-black/30 text-press-black',
  gated: 'border-press-black/30 text-newsprint-gray',
}

const jobChip: Record<Erc8183Job['status'], string> = {
  Open: 'border-slate-verdant/50 text-newsprint-gray',
  Funded: 'border-highlighter-green/50 text-highlighter-green',
  Submitted: 'border-highlighter-green/50 text-highlighter-green',
  Completed: 'border-highlighter-green/40 text-highlighter-green',
  Rejected: 'border-press-black/30 text-press-black',
  Expired: 'border-press-black/20 text-newsprint-gray',
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

function sessionModeLabel(mode: ActiveHireSession['mode']): string {
  if (mode === 'b402') return 'BNB Chain (x402)'
  if (mode === 'prod') return 'Production'
  return 'Sandbox facilitator'
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

  useEffect(() => {
    void getActiveAccount().then((a) => setAccount(a))
  }, [])

  const load = useCallback(async () => {
    if (!account) {
      setData(null)
      return
    }
    try {
      const next = await getOngoing(account)
      setData(next)
      setError(null)
    } catch (e) {
      setError(hireErrorText(e))
    }
  }, [account])

  useEffect(() => {
    void load()
    if (!account) return
    const id = window.setInterval(() => {
      void load()
    }, 2500)
    return () => window.clearInterval(id)
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

  const sessions = data?.sessions ?? []
  const recent = data?.recentTasks ?? []
  const counts = data?.counts
  const recentPaymentIds = new Set(recent.map(({ task }) => task.paymentId))
  const standaloneRevocations = Object.entries(revokeResults).filter(
    ([paymentId]) => !recentPaymentIds.has(paymentId),
  )

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Your hires in flight</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
          Ongoing.
        </h1>
        {account && counts && (
          <div className="flex flex-wrap gap-6 text-[13px] text-newsprint-gray">
            <span>
              <strong className="text-press-black">{counts.activeHires}</strong> active
            </span>
            <span>
              <strong className="text-press-black">{counts.jobsFunded ?? 0}</strong> funded
            </span>
            <span>
              <strong className="text-press-black">{counts.jobsSubmitted ?? 0}</strong> submitted
            </span>
            <span>
              <strong className="text-press-black">{counts.jobsCompleted ?? 0}</strong> completed
            </span>
          </div>
        )}
      </div>

      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Sessions and ERC-8183 jobs for the wallet you connect. Hire opens a job
        (Funded), delivery submits it, you attest complete or reject. Settlement
        still runs over x402 to the agent&apos;s own wallet.
      </p>

      {!account && (
        <div className="mt-10 rounded-[14px] border hairline border-slate-verdant/40 p-10">
          <p className="text-[15px] text-typesetter-ink">
            Connect the wallet you hired with.
          </p>
          <p className="mt-2 text-[13px] text-newsprint-gray">
            Ongoing is per-wallet. Without a connection we cannot tell which
            hires are yours.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="micro mt-6 rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        </div>
      )}

      {account && (
        <p className="micro mt-6 text-newsprint-gray">
          Showing hires for <span className="font-mono text-press-black">{shortAddr(account)}</span>
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
          {error}
        </p>
      )}

      {account && (
        <div className="mt-10 space-y-4">
          {sessions.length === 0 && !error && (
            <div className="rounded-[14px] border hairline border-slate-verdant/40 p-10">
              <p className="text-[15px] text-newsprint-gray">
                No active hires for this wallet on this server instance.
              </p>
              <p className="mt-2 text-[13px] text-newsprint-gray/80">
                Hire from the marketplace with this wallet. Sandbox and live
                settlements both show up here while the session is open.
              </p>
              <Link
                to="/agents"
                className="micro mt-6 inline-block rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95"
              >
                Browse agents
              </Link>
            </div>
          )}

          {sessions.map(({ session, task, job }) => (
            <article
              key={session.paymentId}
              className="rounded-[14px] border hairline border-slate-verdant/40 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link
                    to={`/agents/${session.chainId}/${session.tokenId}`}
                    className="font-serif text-[28px] leading-none text-press-black hover:text-highlighter-green"
                  >
                    {session.agentName}
                  </Link>
                  <p className="micro mt-2 text-newsprint-gray">
                    hire session · {formatExpiry(session.expiresAt)} ·{' '}
                    {sessionModeLabel(session.mode)}
                  </p>
                  {job && (
                    <p className="micro mt-2 flex flex-wrap items-center gap-2 text-newsprint-gray">
                      <span>ERC-8183</span>
                      <span
                        className={`rounded-full border hairline px-2.5 py-1 ${jobChip[job.status]}`}
                      >
                        {job.status}
                      </span>
                      <span>budget ${job.budgetUsd}</span>
                      {job.deliverable ? <span>deliverable on file</span> : null}
                    </p>
                  )}
                </div>
                <div className="text-right text-[13px] text-newsprint-gray">
                  <div>
                    spend cap{' '}
                    <span className="text-press-black">${session.spendCapUsd}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px]">
                    {session.paymentId.slice(0, 18)}…
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevoke(session.paymentId)}
                    disabled={revokingId === session.paymentId}
                    className="micro mt-3 rounded-[5px] border hairline border-press-black/30 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
                  >
                    {revokingId === session.paymentId ? 'Revoking…' : 'Revoke session'}
                  </button>
                </div>
              </div>

              <div className="mt-6 border-t hairline border-slate-verdant/30 pt-5">
                {task ? (
                  <TaskRow task={task} onRetry={onRetry} retrying={retryingId === task.id} />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[14px] text-newsprint-gray">
                      Job Funded. No delivery yet.
                    </p>
                    <Link
                      to={`/agents/${session.chainId}/${session.tokenId}`}
                      className="micro rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black"
                    >
                      Run a task
                    </Link>
                  </div>
                )}

                {job && job.status === 'Submitted' && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => onJob(job.id, 'complete')}
                      disabled={jobBusy === job.id}
                      className="micro rounded-[5px] bg-highlighter-green px-3 py-2 text-typesetter-ink shadow transition hover:brightness-95 disabled:opacity-60"
                    >
                      Complete job
                    </button>
                    <button
                      type="button"
                      onClick={() => onJob(job.id, 'reject')}
                      disabled={jobBusy === job.id}
                      className="micro rounded-[5px] border hairline border-press-black/30 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                )}
                {job && job.status === 'Funded' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => onJob(job.id, 'reject')}
                      disabled={jobBusy === job.id}
                      className="micro rounded-[5px] border hairline border-press-black/30 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
                    >
                      Reject before work
                    </button>
                  </div>
                )}
                {job && (job.status === 'Completed' || job.status === 'Rejected') && (
                  <p className="mt-3 text-[12px] text-newsprint-gray">
                    Terminal · {job.status}
                    {job.attestation ? ` · ${job.attestation}` : ''}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {account && standaloneRevocations.length > 0 && (
        <div className="mt-10">
          <p className="micro text-newsprint-gray">Revocations</p>
          <div className="mt-3 space-y-2">
            {standaloneRevocations.map(([paymentId, outcome]) => (
              <div
                key={paymentId}
                className="rounded-[10px] border hairline border-slate-verdant/30 p-4"
              >
                <p className="micro font-mono text-press-black">{paymentId.slice(0, 18)}…</p>
                <RevokeNote outcome={outcome} chainId={outcome.chainId ?? 0} />
              </div>
            ))}
          </div>
        </div>
      )}

      {account && recent.length > 0 && (
        <div className="mt-16">
          <p className="micro text-newsprint-gray">Recent tasks (session ended)</p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-newsprint-gray">
            Ended sessions keep their agent, job and deliverable here. Revoke
            closes the session in the ledger and cancels the buyer&apos;s
            authorization on the settlement token when the stored payload and
            relay key allow it; the cancellation transaction is linked below.
          </p>
          <div className="mt-6 space-y-3">
            {recent.map(({ task, job }) => (
              <article
                key={task.id}
                className="rounded-[10px] border hairline border-slate-verdant/30 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/agents/${task.chainId}/${task.tokenId}`}
                      className="font-serif text-[22px] leading-none text-press-black hover:text-highlighter-green"
                    >
                      {task.agentName}
                    </Link>
                    <p className="micro mt-2 text-newsprint-gray">
                      chain {task.chainId} · token {task.tokenId} ·{' '}
                      <span className="font-mono">{task.paymentId.slice(0, 18)}…</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevoke(task.paymentId)}
                    disabled={revokingId === task.paymentId}
                    className="micro rounded-[5px] border hairline border-press-black/30 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
                  >
                    {revokingId === task.paymentId ? 'Revoking…' : 'Revoke session'}
                  </button>
                </div>

                {revokeResults[task.paymentId] && (
                  <RevokeNote
                    outcome={revokeResults[task.paymentId]}
                    chainId={task.chainId}
                  />
                )}

                <div className="mt-4">
                  <TaskRow task={task} onRetry={onRetry} retrying={retryingId === task.id} />
                </div>

                {job && (
                  <p className="micro mt-3 text-newsprint-gray">
                    job <span className="text-press-black">{job.status}</span>
                    {job.budgetUsd ? ` · budget $${job.budgetUsd}` : ''}
                    {job.deliverable ? ' · deliverable recorded' : ''}
                    {job.attestation ? ` · ${job.attestation}` : ''}
                  </p>
                )}

                <Link
                  to={`/agents/${task.chainId}/${task.tokenId}`}
                  className="micro mt-3 inline-block rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black"
                >
                  Open agent and session
                </Link>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function TaskRow({
  task,
  onRetry,
  retrying,
  compact,
}: {
  task: HireTask
  onRetry: (id: string) => void
  retrying: boolean
  compact?: boolean
}) {
  const canRetry = task.status === 'failed' && task.attempts < task.maxAttempts
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`micro rounded-full border hairline px-2.5 py-1 ${taskChip[task.status]}`}
          >
            {task.status === 'running' ? 'task running' : task.status}
          </span>
          <span className="text-[13px] text-typesetter-ink">
            {task.tool ?? task.taskText ?? 'awaiting first run'}
          </span>
        </div>
        <span className="micro text-newsprint-gray">
          attempt {task.attempts}/{task.maxAttempts}
          {task.protocol ? ` · ${task.protocol}` : ''}
        </span>
      </div>

      {task.quality && (
        <p className="text-[12px] text-newsprint-gray">
          quality <span className="text-press-black">{task.quality.grade}</span> (
          {task.quality.score})
          {task.quality.reason ? ` · ${task.quality.reason}` : ''}
        </p>
      )}
      {task.error && (
        <p className="text-[12px] leading-relaxed text-press-black/80">{task.error}</p>
      )}
      {task.result && !compact && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-[8px] border hairline border-slate-verdant/30 bg-bone-white p-3 font-mono text-[11px] leading-relaxed text-press-black">
          {task.result.length > 500 ? `${task.result.slice(0, 500)}…` : task.result}
        </pre>
      )}
      {canRetry && (
        <button
          type="button"
          onClick={() => onRetry(task.id)}
          disabled={retrying}
          className="micro rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
        >
          {retrying ? 'Retrying…' : 'Retry delivery'}
        </button>
      )}
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
