import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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
import { chainLabel, explorerTxBase } from '../lib/contracts'
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
import { StopRail } from '../components/Jobs8183HirePanel'
import Jobs8183JobCard from '../components/Jobs8183JobCard'
import { EscrowFlowCard } from '../components/EscrowFlowCard'
import { ReceiptsList } from '../components/ReceiptsList'
import { hireErrorText } from '../lib/hire'
import { chainIdToHex, ensureBscChain, getProvider, setTargetChain } from '../lib/wallet'
import { useConnectedAccount } from '../lib/use-connected-account'
import { encodeFunctionData, keccak256, toBytes } from 'viem'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from '../lib/register'
import { ratedHires } from '../lib/rating'
import { RateAgent } from '../components/RateAgent'
import { Action, Dialog, LABEL, RatingBoxes, ResultBox, TextSlot } from '../components/ui'
import { revokeSessionWithCancel, type RevokeOutcome } from '../lib/sessions'
import {
  AgentAvatar,
  Btn,
  DataTable,
  Dot,
  Pill,
  Row,
  Rule,
  Section,
  SectionHead,
  Stack,
  Txt,
} from '../components/souk'

// the server holds each wallet's view for five seconds, so a faster poll only
// re-reads the same answer; thirty seconds keeps the view live without burning
// a function invocation every five seconds
const POLL_MS = 30_000

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

// which of the five stops a job sits on, read from its own status rather than
// guessed: an open job has only its price, a funded one holds money, and so on
function stopIndexFor(item: HireItem): number {
  const status = item.job?.status
  if (!status) return item.task ? 2 : 0
  if (status === 'Open') return 0
  if (status === 'Funded') return 1
  if (status === 'Submitted') return 3
  if (status === 'Completed' || status === 'Rejected') return 4
  return 2
}

export function OngoingPage() {
  // the buyer's wallet, watched so a switch inside the wallet re-reads the board
  // and the escrows that wallet holds
  const account = useConnectedAccount()
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
  // the chain comes from the hires themselves rather than a page-level constant,
  // since a wallet can hold jobs on more than one
  const chainLine = items.length > 0 ? chainLabel(items[0].chainId) : null
  const kicker = account
    ? ['Ongoing', shortAddr(account), chainLine, data ? `${liveCount} live` : null].filter(Boolean).join(' · ')
    : 'Ongoing'

  return (
    <div className="mx-auto min-h-screen bg-souk-canvas px-4 lg:px-8 pb-28 pt-10 text-souk-ink lg:pb-16">
      {/* the hero owns its own top padding, so the band carries only the lower half of the rhythm */}
      <Section pad="pb-16 md:pb-18">
        <header className="flex w-full flex-col gap-2.5">
          <Txt size={11} lead={16} mono upper tone="data">
            {kicker}
          </Txt>
          <h1 className="m-0">
            <Txt size={34} lead={42} display weight="bold" tone="ink">
              Work in flight.
            </Txt>
          </h1>
          <Txt size={15} lead={23} tone="slate">
            Released is the only stop that pays the seller.
          </Txt>
        </header>

        {!account && (
          <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
            <Txt size={15} lead={22} tone="ink">
              Connect the wallet you hired with.
            </Txt>
            <Txt size={12} lead={18} tone="steel">
              Connect from the rail on the left, or the bar above on a narrow screen.
            </Txt>
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

        {account && data && items.length === 0 && kernelJobs.length === 0 && !error && (
          <Stack surface pad={[28, 28, 28, 28]} gap={8} className="mt-8 max-w-[680px]">
            <Txt size={15} lead={22} tone="ink">
              Nothing hired with this wallet yet.
            </Txt>
            <Txt size={13} lead={20} tone="muted">
              Hire an agent and it shows up here while you use it.
            </Txt>
            <Link
              to="/agents"
              className="mt-2 inline-flex h-11 w-fit items-center justify-center rounded-none bg-souk-data px-5"
            >
              <Txt size={14} lead={20} weight="semibold" tone="canvas">
                Browse agents
              </Txt>
            </Link>
          </Stack>
        )}
      </Section>

      {account &&
        groups.map((g) => {
          const list = byGroup(g.key)
          if (list.length === 0) return null
          return (
            <Section key={g.key}>
              <SectionHead title={g.title} note={`${list.length}`} />
              <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
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
                {/* the drawing's task and escrow cards, alongside the row: the stop the
                    job sits on and its event stream come from the task's own history,
                    and the escrow's figures from the payment rather than the job */}
                {list.map((it) => (
                  <Fragment key={`${it.key}-cards`}>
                    {it.task?.history && it.task.history.length > 0 ? (
                      <OpenTaskCard item={it} at={stopIndexFor(it)} />
                    ) : null}
                    {it.escrow ? (
                      <EscrowFacts
                        escrow={it.escrow}
                        item={it}
                        onReject={onJobReject}
                        busy={jobBusy === (it.job?.id ?? '')}
                        canAct={Boolean(account) && Boolean(it.escrow.buyer) && account?.toLowerCase() === it.escrow.buyer.toLowerCase()}
                      />
                    ) : null}
                  </Fragment>
                ))}
              </div>
            </Section>
          )
        })}

      {account && kernelJobs.length > 0 && (
        <Section>
          <SectionHead title="ERC-8183 jobs" note={`${kernelJobs.length}`} />
          <Txt size={13} lead={20} tone="muted" className="mt-3 block max-w-[760px]">
            Funded on the shared kernel; the status below is read from the chain, not from a promise.
          </Txt>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {kernelJobs.map((row) => (
              <Jobs8183JobCard key={row.id} job={row} />
            ))}
          </div>
        </Section>
      )}

      {account && items.length > 0 && (
        <Section>
          <SectionHead title="Every task, one ledger" note="same order as the board" />
          <div className="mt-12">
            {/* six columns as the drawing lays them out. the money column reads the
                figure the buyer committed in dollars, since the escrow's own amount
                is a raw string with no unit this page can prove */}
            <DataTable
              cols={[420, 330, 250, 280, 240, 336]}
              header={['Task', 'Agent', 'State', 'Committed', 'Age', 'Last event']}
              rows={items.map((i) => {
                const committed = i.job
                  ? `$${i.job.budgetUsd.toFixed(2)}`
                  : i.session
                    ? `$${i.session.spendCapUsd.toFixed(2)} cap`
                    : 'none yet'
                const last = i.task?.updatedAt ?? i.job?.updatedAt ?? i.at
                return {
                  cells: [
                    { text: shortAddr(i.key), mono: true, tone: 'ink' },
                    { text: i.agentName, weight: 'semibold', tone: 'slate' },
                    { text: hireState(i).label, weight: 'semibold', tone: LEDGER_TONE[hireState(i).group] },
                    { text: committed, mono: true, tone: 'slate' },
                    { text: timeAgo(i.at), mono: true, tone: 'labels' },
                    { text: timeAgo(last), mono: true, tone: 'labels' },
                  ],
                }
              })}
            />
          </div>
        </Section>
      )}

      {account && standaloneRevocations.length > 0 && (
        <Section>
          <SectionHead title="Revoked" note={`${standaloneRevocations.length}`} />
          <Stack gap={8} className="mt-12">
            {standaloneRevocations.map(([paymentId, outcome]) => (
              <Stack key={paymentId} pad={[16, 16, 16, 16]} radius={14} hair>
                <RevokeNote outcome={outcome} chainId={outcome.chainId ?? 0} />
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      {account && (
        <Section>
          <Rule />
          <Txt size={12} lead={18} tone="muted" className="mt-3 block max-w-[1180px]">
            A retry keeps the task id and the escrow it was funded with. A revoke is unconditional and
            returns the escrow in one transaction, and only a released job counts as earned.
          </Txt>
        </Section>
      )}
    </div>
  )
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
  const rateable = job ? (job.status === 'Completed' || job.status === 'Submitted') : task?.status === 'delivered'
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
        state.group === 'needs' ? 'border-souk-data/40' : 'border-souk-edge'
      }`}
    >
      <Row justify="between" align="center" gap={12}>
        <Row align="center" gap={11} className="min-w-0">
          <AgentAvatar size={34} name={item.agentName} chainId={item.chainId} tokenId={item.tokenId} />
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
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-none border border-souk-hair bg-souk-surface1 px-3 transition hover:border-souk-hair disabled:cursor-not-allowed disabled:opacity-40"
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

      <div className="mt-2">
        <Txt size={10} lead={14} upper tone="muted" className="mb-1">Execution receipts</Txt>
        <ReceiptsList agent={item.agentName} chainId={item.chainId} />
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

// the drawing's task card: one live task with the stop it sits on and the event
// stream the job has produced so far, read from the task's own history
function OpenTaskCard({ item, at }: { item: HireItem; at: number }) {
  const { session, task, job } = item
  const events = task?.history ?? []
  const shown = events.slice(-5)
  const cap = session ? `$${session.spendCapUsd.toFixed(2)} cap` : null
  const left = session ? formatExpiry(session.expiresAt) : null
  const retries = task ? task.maxAttempts - task.attempts : null
  return (
    <article className="flex min-w-0 flex-col rounded-none border border-souk-edge bg-souk-surface1 p-[22px] pb-[18px]">
      <Row justify="between" align="center" gap={12} className="flex-wrap">
        <Row align="center" gap={11} className="min-w-0">
          <AgentAvatar size={34} name={item.agentName} chainId={item.chainId} tokenId={item.tokenId} />
          <Link to={`/agents/${item.chainId}/${item.tokenId}`} className="min-w-0 truncate">
            <Stack gap={2}>
              <Txt size={17} lead={22} weight="bold" tone="ink">{item.agentName}</Txt>
              <Txt size={11} lead={15} mono tone="labels">{`task ${shortAddr(item.key)}`}</Txt>
            </Stack>
          </Link>
        </Row>
        <Row align="center" gap={8} className="flex-wrap">
          <Pill variant="keep">{job ? 'Working' : 'Waiting'}</Pill>
          <Pill variant="off">{`Chain ${item.chainId}`}</Pill>
        </Row>
      </Row>
      {cap && left ? (
        <Txt size={11} lead={15} mono tone="data" className="mt-2">{`${left} · ${cap}`}</Txt>
      ) : null}

      <Txt size={18} lead={27} weight="bold" tone="ink" className="mt-4">Where the job is</Txt>
      <div className="mt-3">
        <StopRail at={at} />
      </div>

      <div className="mt-4">
        <Rule />
      </div>
      <Row justify="between" align="center" className="mt-4">
        <Txt size={18} lead={27} weight="bold" tone="ink">Events</Txt>
        <Txt size={10} lead={14} mono upper tone="labels">the task streams until it completes</Txt>
      </Row>
      {shown.length > 0 ? (
        <Stack gap={0} className="mt-2">
          {shown.map((h, i) => (
            <Row key={`${h.at}-${i}`} align="center" gap={12} className="min-h-[22px]">
              <Txt size={11} lead={16} mono tone="labels" className="w-[96px] shrink-0">{timeAgo(h.at)}</Txt>
              <Txt size={12} lead={18} mono tone="slate" className="min-w-0 flex-1">
                {h.note ? `${h.status} · ${h.note}` : h.status}
              </Txt>
            </Row>
          ))}
        </Stack>
      ) : (
        <Txt size={12} lead={18} tone="muted" className="mt-2">No events yet. The stream starts when the task runs.</Txt>
      )}
      {retries !== null ? (
        <Txt size={12} lead={18} tone="steel" className="mt-3">
          {retries > 0
            ? `A retry keeps the same task id and the same escrow. ${retries} are left before the job counts as failed.`
            : 'No retries are left. The next failure releases whatever the work did not earn.'}
        </Txt>
      ) : null}
    </article>
  )
}

// the escrow's own facts, read from the payment rather than from the job, since
// the money can outlive a finished job
function EscrowFacts({
  escrow,
  item,
  onReject,
  busy,
  canAct,
}: {
  escrow: EscrowStatus
  item: HireItem
  onReject?: (item: HireItem) => void
  busy?: boolean
  canAct?: boolean
}) {
  const held = escrow.status === 0
  const released = escrow.verifiedAt > 0
  const amount = item.job ? `$${item.job.budgetUsd.toFixed(2)}` : 'not priced'
  // the honest way out of escrowed money, read the same way the page's own reject
  // reads it: refund before anything was verified, a dispute inside the window
  // after, and a plain refusal the chain agrees with
  const move = escrowRejectMove(escrow)
  const rows: { label: string; value: string; tone: 'ink' | 'data' | 'muted' | 'slate' }[] = [
    { label: 'Quoted', value: amount, tone: 'ink' },
    { label: 'Funded', value: held ? amount : released ? amount : 'nothing yet', tone: held || released ? 'data' : 'muted' },
    { label: 'Released', value: released ? amount : 'nothing yet', tone: released ? 'data' : 'muted' },
    { label: 'Payment', value: shortAddr(escrow.paymentId), tone: 'slate' },
    { label: 'Timeout', value: escrow.windowEndsAt ? formatExpiry(new Date(escrow.windowEndsAt * 1000).toISOString()) : 'none set', tone: 'slate' },
    { label: 'Status', value: held ? 'held by the funder' : released ? 'settled' : 'closed', tone: 'ink' },
  ]
  return (
    <article className="flex min-w-0 flex-col rounded-none border border-souk-edge bg-souk-surface1 p-4 pb-[14px]">
      <Row justify="between" align="center" className="pb-[9px]">
        <Txt size={18} lead={27} weight="bold" tone="ink">The escrow</Txt>
        <Txt size={10} lead={14} mono upper tone="labels">{`chain ${item.chainId}`}</Txt>
      </Row>
      <Rule />
      <Stack gap={0} className="mt-[10px]">
        {rows.map((r) => (
          <Row key={r.label} justify="between" align="center" className="min-h-[26px]">
            <Txt size={12} lead={18} tone="muted">{r.label}</Txt>
            <Txt size={12} lead={18} mono tone={r.tone}>{r.value}</Txt>
          </Row>
        ))}
      </Stack>
      <div className="mt-[10px]">
        <Rule />
      </div>
      <Txt size={12} lead={18} tone="steel" className="mt-[10px]">
        A revoke is unconditional. It is the buyer's own money out, and it is not gated on the timeout.
      </Txt>
      {onReject ? (
        <div className="mt-[10px] flex flex-wrap items-center gap-2">
          <Btn
            kind="off"
            disabled={busy || !canAct || move.kind === 'plain' || move.kind === 'refuse'}
            onClick={() => onReject(item)}
          >
            {busy ? 'Waiting for your wallet' : move.kind === 'reject' ? 'Dispute this delivery' : 'Refund'}
          </Btn>
          {!canAct ? (
            <Txt size={11} lead={16} tone="muted">Only the wallet that paid can move it.</Txt>
          ) : move.kind === 'refuse' ? (
            <Txt size={11} lead={16} tone="muted" className="min-w-0 flex-1">{move.reason}</Txt>
          ) : (
            <Txt size={11} lead={16} tone="muted" className="min-w-0 flex-1">
              {move.kind === 'reject'
                ? 'Inside the dispute window: the money comes back before the record changes.'
                : 'Nothing was verified against this payment, so the whole deposit comes back.'}
            </Txt>
          )}
        </div>
      ) : null}
    </article>
  )
}
