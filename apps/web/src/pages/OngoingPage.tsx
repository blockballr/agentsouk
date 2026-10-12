import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  actOnJob,
  getEscrowStatuses,
  getHiresByWallet,
  getJobs8183Jobs,
  getOngoing,
  retryTask,
  type EscrowStatus,
  type Jobs8183Row,
  type OngoingBundle,
} from '../lib/api'
import { timeAgo } from '@agora/core'
import { explorerTxBase } from '../lib/contracts'
import { mergeSessions, stabiliseSessions } from '../lib/ongoing-merge'
import {
  escrowLifecycle,
  escrowRejectMove,
  hireItems,
  hireState,
  readableResult,
  type HireGroup,
  type HireItem,
  type HireState,
} from '../lib/hire-state'
import { EscrowFlowCard } from '../components/EscrowFlowCard'
import { hireErrorText } from '../lib/hire'
import { chainIdToHex, connectWallet, ensureBscChain, getActiveAccount, getProvider, setTargetChain } from '../lib/wallet'
import { encodeFunctionData, keccak256, toBytes } from 'viem'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { ratedHires } from '../lib/rating'
import { jobStatusName } from '../lib/jobs8183'
import { RateAgent } from '../components/RateAgent'
import { Action, Dialog, LABEL, RatingBoxes, ResultBox, TextSlot } from '../components/ui'
import { revokeSessionWithCancel, type RevokeOutcome } from '../lib/sessions'
import { AgentAvatar, Btn, DataTable, Dot, Pill, Row, Rule, SectionHead, Stack, Txt } from '../components/souk'

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
  const [kernelJobs, setKernelJobs] = useState<Jobs8183Row[]>([])
  const inFlight = useRef(false)

  useEffect(() => {
    void getActiveAccount().then((a) => setAccount(a))
  }, [])

  // kernel jobs are a slower loop: the escrow holds days, so one read per
  // connect plus one after each load is plenty
  useEffect(() => {
    if (!account) {
      setKernelJobs([])
      return
    }
    let cancelled = false
    getJobs8183Jobs(account).then((rows) => {
      if (!cancelled) setKernelJobs(rows)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account])

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
  // the live count is only claimed once the ledger has answered
  const liveCount = items.filter((i) => i.live).length
  const kicker = account
    ? ['Ongoing', shortAddr(account), data ? `${liveCount} live` : null].filter(Boolean).join(' · ')
    : 'Ongoing'

  return (
    <div className="mx-auto min-h-screen max-w-[1920px] bg-souk-canvas px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      <header className="flex max-w-[1180px] flex-col gap-2.5">
        <Txt size={11} lead={16} mono upper tone="data">
          {kicker}
        </Txt>
        <h1 className="m-0">
          <Txt size={34} lead={42} weight="bold" tone="ink">
            Your hires.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          Everything this wallet has hired. Anything waiting on you comes first.
        </Txt>
      </header>

      {!account && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Connect the wallet you hired with.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            Hires are kept per wallet, so this is how we find yours.
          </Txt>
          <Btn kind="primary" onClick={onConnect} disabled={connecting} className="mt-2 self-start">
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </Btn>
        </Stack>
      )}

      {error && (
        <div role="alert" className="mt-6">
          <Stack pad={[14, 16, 14, 16]} radius={14} hair>
            <Txt size={13} lead={20} tone="peach">
              {error}
            </Txt>
          </Stack>
        </div>
      )}

      {account && data && items.length === 0 && !error && (
        <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
          <Txt size={15} lead={22} tone="ink">
            Nothing hired with this wallet yet.
          </Txt>
          <Txt size={13} lead={20} tone="muted">
            Hire an agent and it shows up here while you use it.
          </Txt>
          <Link
            to="/agents"
            className="mt-2 inline-flex h-11 w-fit items-center justify-center rounded-[8px] bg-souk-data px-5"
          >
            <Txt size={14} lead={20} weight="semibold" tone="canvas">
              Browse agents
            </Txt>
          </Link>
        </Stack>
      )}

      {account &&
        groups.map((g) => {
          const list = byGroup(g.key)
          if (list.length === 0) return null
          return (
            <div key={g.key} className="mt-10">
              <SectionHead title={g.title} note={`${list.length}`} />
              <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
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

      {account && kernelJobs.length > 0 && (
        <div className="mt-10">
          <SectionHead title="ERC-8183 jobs" note={`${kernelJobs.length}`} />
          <Txt size={13} lead={20} tone="muted" className="mt-3 block max-w-[760px]">
            Funded on the shared kernel; the status below is read from the chain, not from a promise.
          </Txt>
          <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {kernelJobs.map((row) => (
              <Stack key={row.id} surface pad={[16, 16, 16, 16]} gap={10}>
                <Row justify="between" align="baseline" gap={12}>
                  <Link to={`/agents/${row.chainId}/${row.tokenId}`} className="min-w-0 truncate">
                    <Txt size={15} lead={20} weight="bold" tone="ink">
                      {row.agentName}
                    </Txt>
                  </Link>
                  <Txt size={13} lead={20} mono tone="data">
                    {row.budgetUsd} $U
                  </Txt>
                </Row>
                <Row justify="between" align="center" gap={12}>
                  <Txt size={12} lead={18} mono tone="muted">
                    {formatExpiry(row.expiredAt)}
                  </Txt>
                  <Pill variant={JOBS8183_PILL[row.status === null ? 'unreached' : jobStatusName(row.status)] ?? 'off'}>
                    {row.status === null ? 'unreached' : jobStatusName(row.status)}
                  </Pill>
                </Row>
                <Txt size={12} lead={18} tone="muted">
                  kernel job{' '}
                  <Txt size={12} lead={18} mono tone="slate">
                    {row.onchainJobId}
                  </Txt>
                </Txt>
              </Stack>
            ))}
          </div>
        </div>
      )}

      {account && items.length > 0 && (
        <div className="mt-10">
          <SectionHead title="Every task, one ledger" note="same order as the board" />
          <div className="mt-5">
            <DataTable
              cols={[380, 320, 620, 180]}
              header={['Task', 'Agent', 'State', 'Age']}
              rows={items.map((i) => ({
                cells: [
                  { text: shortAddr(i.key), mono: true, tone: 'ink' },
                  { text: i.agentName, weight: 'semibold', tone: 'slate' },
                  { text: hireState(i).label, weight: 'semibold', tone: LEDGER_TONE[hireState(i).group] },
                  { text: timeAgo(i.at), mono: true, tone: 'labels' },
                ],
              }))}
            />
          </div>
        </div>
      )}

      {account && standaloneRevocations.length > 0 && (
        <div className="mt-10">
          <SectionHead title="Revoked" note={`${standaloneRevocations.length}`} />
          <Stack gap={8} className="mt-4">
            {standaloneRevocations.map(([paymentId, outcome]) => (
              <Stack key={paymentId} pad={[16, 16, 16, 16]} radius={14} hair>
                <RevokeNote outcome={outcome} chainId={outcome.chainId ?? 0} />
              </Stack>
            ))}
          </Stack>
        </div>
      )}

      {account && (
        <div className="mt-10">
          <Rule />
          <Txt size={12} lead={18} tone="muted" className="mt-3 block max-w-[1180px]">
            A retry keeps the task id and the escrow it was funded with. A revoke is unconditional and
            returns the escrow in one transaction, and only a released job counts as earned.
          </Txt>
        </div>
      )}
    </div>
  )
}

// kernel job statuses in the design's two marked chips: the ones the buyer still
// holds earn the data rim, the closed ones rest on the hairline
const JOBS8183_PILL: Record<string, 'keep' | 'warn' | 'off'> = {
  Open: 'off',
  Funded: 'keep',
  Submitted: 'keep',
  Completed: 'keep',
  Rejected: 'off',
  Expired: 'off',
  unreached: 'off',
}

const STATE_DOT: Record<HireGroup, 'good' | 'sky' | 'quiet'> = {
  needs: 'good',
  progress: 'sky',
  finished: 'quiet',
}

// the ledger's state column reads the group, so the three states sit at the
// same three tones the dot uses beside a card
const LEDGER_TONE: Record<HireGroup, 'data' | 'sky' | 'steel'> = {
  needs: 'data',
  progress: 'sky',
  finished: 'steel',
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
  const spine = escrowLifecycle(escrowRow)
  const escrowed = escrowRow?.status === 0
  const isBuyer = Boolean(account && escrowRow && account.toLowerCase() === escrowRow.buyer.toLowerCase())
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
    <article
      className={`flex h-[520px] min-w-0 flex-col rounded-[20px] border bg-souk-surface1 p-5 [overflow-wrap:anywhere] ${
        state.group === 'needs' ? 'border-souk-data/40' : 'border-white/[0.08]'
      }`}
    >
      <Row justify="between" align="center" gap={12}>
        <Row align="center" gap={11} className="min-w-0">
          <AgentAvatar size={34} name={item.agentName} />
          <Link to={agentHref} className="min-w-0 truncate">
            <Txt size={16} lead={24} weight="bold" tone="ink">
              {item.agentName}
            </Txt>
          </Link>
        </Row>
        {/* the buyer's control over a live session, so it is the plainest button on the card; an
            ended session has nothing left to spend and shows none */}
        {item.live && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.16] bg-souk-surface1 px-3 transition hover:border-white/[0.32] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Txt size={12} lead={18} weight="semibold" tone="slate">
              {revoking ? 'Revoking…' : 'Revoke session'}
            </Txt>
          </button>
        )}
      </Row>
      <Row align="center" gap={8} className="mt-1 min-w-0">
        <Dot tone={STATE_DOT[state.group]} size={9} />
        <Txt size={14} lead={20} tone="slate" className="truncate">
          {state.label}
        </Txt>
      </Row>
      {/* the money's own progression, collapsed to a bar until the buyer clicks
          it open; the stops that already passed are filled, and the money's
          current stop pulses */}
      {spine && <EscrowFlowCard spine={spine} agentName={item.agentName} />}
      <TextSlot lines={2} className="mt-1">{state.note ?? ''}</TextSlot>
      <TextSlot lines={1} className="mt-1 text-[12px]">{meta}</TextSlot>
      <TextSlot lines={2} className="mt-3">
        {asked ? (
          <>
            You asked: <span className="text-souk-ink">{asked}</span>
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
                {escrowed ? 'Complete · releases the payment' : 'Complete job'}
              </Action>
              <Action onClick={onReject} disabled={busy} className="w-full">
                {escrowed ? 'Reject · refunds you' : 'Reject'}
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
              {escrowed ? 'Reject · refunds you' : 'Reject before work'}
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
