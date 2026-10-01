import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { categoryDef, shortAddress } from '@agora/core'
import { connectWallet, getActiveAccount } from '../lib/wallet'
import { hireErrorText } from '../lib/hire'
import { useTargetChain } from '../lib/target-chain'
import {
  QUEST_STEPS,
  getQuestProgress,
  rankFor,
  readSeenPoints,
  rememberQuestProgress,
  stampsFrom,
  writeQuestMode,
  writeSeenPoints,
  type QuestProgress,
  type QuestStep,
} from '../lib/quest'
import { Action, LABEL, TextSlot, card, cx } from '../components/ui'

const TOTAL = 1000
const REFRESH_MS = 30_000

export function QuestPage() {
  const navigate = useNavigate()
  const target = useTargetChain()
  const chainId = target?.chainId ?? null
  const [wallet, setWallet] = useState<string | null>(null)
  const [progress, setProgress] = useState<QuestProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [shownPoints, setShownPoints] = useState(0)
  const counted = useRef(false)

  useEffect(() => {
    let live = true
    getActiveAccount()
      .then((a) => {
        if (live) setWallet(a)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const load = useCallback(async (address: string) => {
    try {
      const p = await getQuestProgress(address)
      setProgress(p)
      setError(null)
      rememberQuestProgress(p)
    } catch (e) {
      setError(hireErrorText(e))
    }
  }, [])

  // opening the passport is taking part, so a quit or a not-now becomes active again
  useEffect(() => {
    writeQuestMode(wallet, 'active')
    if (!wallet) return
    void load(wallet)
    const tick = () => {
      if (document.visibilityState === 'visible') void load(wallet)
    }
    const timer = setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [wallet, load])

  // the tally counts up from what this browser last showed to the new total
  useEffect(() => {
    if (!wallet || !progress) return
    const before = readSeenPoints(wallet)
    if (!counted.current || progress.points !== before) {
      countUp(before, progress.points, setShownPoints)
      counted.current = true
    }
    writeSeenPoints(wallet, progress.points)
  }, [wallet, progress])

  async function connect() {
    setConnecting(true)
    try {
      setWallet(await connectWallet())
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  function quit() {
    writeQuestMode(wallet, 'quit')
    navigate('/agents')
  }

  const stamps = stampsFrom(progress)
  const next = QUEST_STEPS.find((s) => s.key !== 'seal' && !stamps[s.key]) ?? null
  const points = progress?.points ?? 0
  const rank = rankFor(points)
  const done = QUEST_STEPS.filter((s) => s.key !== 'seal' && stamps[s.key]).length
  // points follow the order steps are finished in, so a stamped card shows what the server
  // awarded and an open hire shows what the next hire earns
  const awarded = new Map((progress?.awards ?? []).map((a) => [a.key, a.points]))
  const hireSteps = QUEST_STEPS.filter((s) => s.category)
  const nextHirePoints = hireSteps[hireSteps.filter((s) => stamps[s.key]).length]?.points ?? 0
  const pointsFor = (step: QuestStep): number => {
    if (step.key === 'seal') return awarded.get('bonus') ?? step.points
    if (step.key === 'stall') return awarded.get('listing') ?? step.points
    return stamps[step.key] ? (awarded.get(step.category ?? '') ?? step.points) : nextHirePoints
  }

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className={LABEL}>Set and Earn quest</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">Souk passport.</h1>
        <div className="flex flex-wrap gap-6 text-[13px] text-newsprint-gray">
          <span>
            <strong className="tabular-nums text-press-black">{shownPoints.toLocaleString()}</strong> of {TOTAL.toLocaleString()} points
          </span>
          <span>
            <strong className="text-press-black">{done}</strong> of 5 stamps
          </span>
          <span>
            titled <strong className="text-press-black">{rank.title}</strong>
          </span>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Hire in four categories and list one agent of your own. A stamp lands when the hire settles, which is when BNB
        Chain&apos;s Set and Earn counts it.
      </p>

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs">
          <span className={LABEL}>{wallet ? `Holder ${shortAddress(wallet)}` : 'No holder yet'}</span>
          <span className="text-newsprint-gray">
            {rank.next ? `${(rank.next.at - points).toLocaleString()} to ${rank.next.title}` : 'Every title earned'}
          </span>
        </div>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-verdant/15"
          role="progressbar"
          aria-label="Quest points"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={points}
        >
          <div className="h-full rounded-full bg-highlighter-green" style={{ width: `${Math.min(100, (shownPoints / TOTAL) * 100)}%` }} />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
          Your passport could not be read just now: {error}
        </p>
      )}

      <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {QUEST_STEPS.map((step, i) => (
          <li key={step.key} className="min-w-0">
            <StepCard
              step={step}
              number={i + 1}
              points={pointsFor(step)}
              stamped={stamps[step.key]}
              isNext={next?.key === step.key}
              chainId={chainId}
              wallet={wallet}
              onConnect={connect}
              connecting={connecting}
            />
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-[13px] leading-relaxed text-newsprint-gray">
          Any order works; the numbers are the shortest route. Points and titles track your progress here and are not a
          token or a reward.
        </p>
        <Action variant="quiet" onClick={quit}>
          Quit the quest
        </Action>
      </div>
    </section>
  )
}

function countUp(from: number, to: number, set: (n: number) => void) {
  if (from === to || typeof requestAnimationFrame === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    set(to)
    return
  }
  const start = performance.now()
  const frame = (now: number) => {
    const k = Math.min(1, (now - start) / 900)
    // ease out, so the tally settles on the new total rather than stopping dead
    set(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))))
    if (k < 1) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

interface StepAction {
  label: string
  to?: string
  onClick?: () => void
  disabled?: boolean
}

// what a step asks for and where its buttons go, worked out once so every card renders the same slots
function stepContent(
  step: QuestStep,
  stamped: boolean,
  chainId: number | null,
  wallet: string | null,
  onConnect: () => void,
  connecting: boolean,
): { title: string; instruction: string; actions: StepAction[] } {
  const title = step.key === 'seal' ? 'The grand seal' : step.key === 'stall' ? 'Open your stall' : step.title
  if (stamped) {
    const what =
      step.key === 'seal'
        ? 'All five are in, with the finishing bonus.'
        : step.key === 'stall'
          ? 'Your listed agent is counted.'
          : 'Your settled hire in this category is counted.'
    return { title, instruction: `Stamped. ${what}`, actions: [] }
  }
  if (step.key === 'seal') {
    return { title, instruction: 'All five stamps land the grand seal, with the finishing bonus.', actions: [] }
  }
  if (!wallet) {
    return {
      title,
      instruction: 'Connect the wallet you will hire with to see its stamps.',
      actions: [{ label: connecting ? 'Waiting for your wallet' : 'Connect wallet', onClick: onConnect, disabled: connecting }],
    }
  }
  if (step.key === 'stall') {
    return {
      title,
      instruction: 'List one agent of your own. Its hires pay your wallet directly.',
      actions: [{ label: 'List an agent', to: '/list' }],
    }
  }
  const pair = chainId !== null ? step.agents?.[chainId] : undefined
  if (pair) {
    const actions: StepAction[] = [{ label: `Hire ${pair.primary.name}`, to: `/agents/${chainId}/${pair.primary.tokenId}?quest=${step.key}` }]
    if (pair.alternate) actions.push({ label: `Or ${pair.alternate.name}`, to: `/agents/${chainId}/${pair.alternate.tokenId}?quest=${step.key}` })
    return {
      title,
      instruction: 'One signature settles the hire. Then run a task on its page.',
      actions,
    }
  }
  const label = step.category ? categoryDef(step.category).label.toLowerCase() : ''
  return {
    title,
    instruction: `Hire any ${label} agent that is not your own.`,
    actions: [{ label: 'Browse the shelf', to: `/agents${step.category ? `?category=${step.category}` : ''}` }],
  }
}

// every step is built from the same parts in the same order at a fixed height, so the passport
// reads as one grid and the actions line up along the bottom
function StepCard({
  step,
  number,
  points,
  stamped,
  isNext,
  chainId,
  wallet,
  onConnect,
  connecting,
}: {
  step: QuestStep
  number: number
  points: number
  stamped: boolean
  isNext: boolean
  chainId: number | null
  wallet: string | null
  onConnect: () => void
  connecting: boolean
}) {
  const { title, instruction, actions } = stepContent(step, stamped, chainId, wallet, onConnect, connecting)
  const state = stamped ? 'Stamped' : isNext ? 'Next up' : 'Not stamped yet'
  return (
    <article
      aria-label={`${title}, ${points} points, ${state.toLowerCase()}`}
      className={cx(card(isNext ? 'strong' : 'plain', 'sm'), 'flex h-[264px] min-w-0 flex-col [overflow-wrap:anywhere]')}
    >
      <p className={LABEL}>
        {step.key === 'seal' ? 'Finish' : `Step ${number}`} · +{points} points
      </p>
      <h2 className="mt-2 truncate font-serif text-[22px] leading-tight text-press-black">{title}</h2>
      <p className="mt-3 flex items-center gap-2 text-[14px] font-medium text-press-black">
        <span
          aria-hidden="true"
          className={cx('h-2 w-2 shrink-0 rounded-full', stamped ? 'glow bg-highlighter-green' : 'border hairline border-newsprint-gray bg-transparent')}
        />
        <span className="truncate">{state}</span>
      </p>
      <TextSlot lines={2} className="mt-1">
        <span title={instruction}>{instruction}</span>
      </TextSlot>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        {actions.map((a, i) => (
          <Action
            key={a.label}
            variant={i === 0 && isNext ? 'primary' : 'secondary'}
            to={a.to}
            onClick={a.onClick}
            disabled={a.disabled}
            className={cx('w-full', actions.length === 1 && 'col-span-2')}
          >
            {a.label}
          </Action>
        ))}
      </div>
    </article>
  )
}
