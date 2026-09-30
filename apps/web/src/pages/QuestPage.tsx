import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { categoryDef, shortAddress } from '@agora/core'
import { connectWallet, getActiveAccount } from '../lib/wallet'
import { useTargetChain } from '../lib/target-chain'
import {
  QUEST_STEPS,
  getQuestProgress,
  rankFor,
  readSeenPoints,
  readSeenStamps,
  rememberQuestProgress,
  stampsFrom,
  writeQuestMode,
  writeSeenPoints,
  writeSeenStamps,
  type QuestProgress,
  type QuestStep,
  type StepKey,
} from '../lib/quest'

const TOTAL = 1000
const REFRESH_MS = 30_000
// a fixed lean per stall, so the passport looks hand-stamped but never shuffles between visits
const LEAN: Record<StepKey, number> = { health: -7, yield: 5, stall: -4, grid: 8, rebalancing: -6, seal: 3 }

export function QuestPage() {
  const navigate = useNavigate()
  const target = useTargetChain()
  const chainId = target?.chainId ?? null
  const [wallet, setWallet] = useState<string | null>(null)
  const [progress, setProgress] = useState<QuestProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [selected, setSelected] = useState<StepKey | null>(null)
  // what this visit animates: stamps newly earned since the last visit, and the points gained
  const [fresh, setFresh] = useState<StepKey[]>([])
  const [shownPoints, setShownPoints] = useState(0)
  const [gain, setGain] = useState(0)
  const [rankChanged, setRankChanged] = useState(false)
  const animated = useRef(false)

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
      setError((e as Error).message)
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

  // the reward moments play once per newly earned stamp, then the browser remembers them
  useEffect(() => {
    if (!wallet || !progress) return
    const stamps = stampsFrom(progress)
    const earned = QUEST_STEPS.map((s) => s.key).filter((k) => stamps[k])
    const seen = readSeenStamps(wallet)
    const before = readSeenPoints(wallet)
    const newly = earned.filter((k) => !seen.includes(k))
    if (!animated.current || newly.length > 0 || progress.points !== before) {
      setFresh(newly)
      setGain(Math.max(0, progress.points - before))
      setRankChanged(rankFor(before).title !== rankFor(progress.points).title)
      countUp(before, progress.points, setShownPoints)
      animated.current = true
    }
    writeSeenStamps(wallet, earned)
    writeSeenPoints(wallet, progress.points)
  }, [wallet, progress])

  async function connect() {
    setConnecting(true)
    try {
      setWallet(await connectWallet())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  function quit() {
    writeQuestMode(wallet, 'quit')
    navigate('/agents')
  }

  const stamps = stampsFrom(progress)
  const next = QUEST_STEPS.find((s) => s.key !== 'seal' && !stamps[s.key]) ?? QUEST_STEPS[5]
  const focus = QUEST_STEPS.find((s) => s.key === selected) ?? next
  const points = progress?.points ?? 0
  const rank = rankFor(points)
  const done = QUEST_STEPS.filter((s) => s.key !== 'seal' && stamps[s.key]).length

  return (
    <section className="mx-auto max-w-[1100px] px-6 pb-24 pt-10">
      <div className="rounded-[14px] border border-press-black p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-press-black pb-5">
          <div>
            <h1 className="font-serif text-[clamp(32px,5vw,48px)] font-medium leading-none tracking-[-0.03em]">Souk passport</h1>
            <p className="mt-3 text-sm text-newsprint-gray">
              {wallet ? `Holder ${shortAddress(wallet)}` : 'No holder yet'} · titled{' '}
              <span key={rank.title} className={`font-medium text-press-black ${rankChanged ? 'quest-reink' : ''}`}>
                {rank.title}
              </span>
            </p>
          </div>
          <div className="relative text-right tabular-nums">
            {gain > 0 && (
              <span key={`${points}-gain`} aria-hidden="true" className="quest-pop absolute -top-6 right-0 font-serif text-lg text-highlighter-green">
                +{gain}
              </span>
            )}
            <span className="font-serif text-[40px] leading-none">{shownPoints.toLocaleString()}</span>
            <span className="text-newsprint-gray"> of {TOTAL.toLocaleString()} points</span>
            <p className="mt-1 text-xs text-newsprint-gray">
              {rank.next ? `${(rank.next.at - points).toLocaleString()} to ${rank.next.title}` : 'Every title earned'}
            </p>
          </div>
        </div>

        <div
          className="mt-5 h-2.5 overflow-hidden rounded-full bg-muted-sage/60"
          role="progressbar"
          aria-label="Quest points"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={points}
        >
          <div className="quest-fill h-full rounded-full bg-highlighter-green" style={{ width: `${Math.min(100, (shownPoints / TOTAL) * 100)}%` }} />
        </div>
        <p className="mt-2 text-xs text-newsprint-gray">{done} of 5 stamps{stamps.seal ? ' and the grand seal' : ''}</p>

        <ol className="mt-8 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6">
          {QUEST_STEPS.map((s) => (
            <li key={s.key} className="text-center">
              <button
                type="button"
                onClick={() => setSelected(s.key)}
                aria-pressed={focus.key === s.key}
                className={`mx-auto block rounded-full p-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
                  focus.key === s.key ? 'bg-highlighter-green/15' : ''
                }`}
              >
                <Stamp step={s} on={stamps[s.key]} fresh={fresh.includes(s.key)} />
              </button>
              <span data-on={stamps[s.key]} className="quest-mark mt-2 inline-block whitespace-nowrap px-1 text-[12px] font-medium sm:text-[13px]">
                {s.title}
              </span>
            </li>
          ))}
        </ol>

        <StepPanel step={focus} stamped={stamps[focus.key]} chainId={chainId} wallet={wallet} onConnect={connect} connecting={connecting} />

        {error && <p className="mt-4 text-xs text-press-black">Your passport could not be read just now: {error}</p>}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t hairline border-muted-sage pt-4 text-xs text-newsprint-gray">
          <p className="max-w-2xl leading-relaxed">
            A stamp lands when the hire settles, which is when BNB Chain&apos;s Set and Earn counts it. Any order works;
            this is the shortest route. Points and titles track your progress here and are not a token or a reward.
          </p>
          <button type="button" onClick={quit} className="underline underline-offset-4 transition hover:text-press-black">
            Quit the quest
          </button>
        </div>
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

function Stamp({ step, on, fresh }: { step: QuestStep; on: boolean; fresh: boolean }) {
  const arc = `quest-arc-${step.key}`
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={on ? `${step.title} stamped, ${step.points} points` : `${step.title}, ${step.points} points, not stamped yet`}
      className={`overflow-visible text-press-black ${step.key === 'seal' ? 'h-24 w-24 sm:h-[120px] sm:w-[120px]' : 'h-[88px] w-[88px] sm:h-[108px] sm:w-[108px]'}`}
    >
      {on ? (
        <g className={fresh ? 'quest-press' : undefined} style={{ transform: `rotate(${LEAN[step.key]}deg)`, transformOrigin: '50px 50px' }}>
          {/* the name rides between the two rings, so its letters never cross either line */}
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeWidth="1" />
          <path id={arc} d="M 14 50 A 36 36 0 0 1 86 50" fill="none" />
          <text fontSize="9" fill="currentColor" letterSpacing="0.6" fontWeight="600">
            <textPath href={`#${arc}`} startOffset="50%" textAnchor="middle">
              {step.title}
            </textPath>
          </text>
          <text x="50" y="56" textAnchor="middle" fontSize={step.key === 'seal' ? 17 : 16} fill="currentColor" className="font-serif">
            +{step.points}
          </text>
        </g>
      ) : (
        <>
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" strokeDasharray="4 5" />
          <text x="50" y="55" textAnchor="middle" fontSize="13" fill="currentColor" fillOpacity="0.55">
            +{step.points}
          </text>
        </>
      )}
    </svg>
  )
}

function StepPanel({
  step,
  stamped,
  chainId,
  wallet,
  onConnect,
  connecting,
}: {
  step: QuestStep
  stamped: boolean
  chainId: number | null
  wallet: string | null
  onConnect: () => void
  connecting: boolean
}) {
  const pair = chainId !== null ? step.agents?.[chainId] : undefined
  const action = 'micro inline-flex min-h-11 items-center rounded-[5px] bg-highlighter-green px-5 text-on-highlighter transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black'
  const quiet = 'underline underline-offset-4 transition hover:text-press-black'

  return (
    <div className="mt-8 rounded-[12px] border hairline border-muted-sage p-5 sm:p-6">
      <h2 className="font-serif text-2xl font-medium tracking-[-0.02em]">
        {step.key === 'seal' ? 'The grand seal' : step.key === 'stall' ? 'Open your stall' : `${step.title} stamp`}
        <span className="ml-2 align-middle text-sm font-normal text-newsprint-gray">+{step.points}</span>
      </h2>

      {stamped ? (
        <p className="mt-3 text-sm text-newsprint-gray">Stamped. This one is already counted for Set and Earn.</p>
      ) : !wallet && step.key !== 'seal' ? (
        <div className="mt-3 space-y-3 text-sm text-newsprint-gray">
          <p>Connect the wallet you will hire with, and your passport shows every stamp it has already earned.</p>
          <button type="button" onClick={onConnect} disabled={connecting} className={action}>
            {connecting ? 'Waiting for your wallet' : 'Connect your wallet'}
          </button>
        </div>
      ) : step.key === 'seal' ? (
        <p className="mt-3 text-sm text-newsprint-gray">
          Collect all five stamps and the grand seal lands on its own, with the finishing bonus.
        </p>
      ) : step.key === 'stall' ? (
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-newsprint-gray">
          <p>List one agent of your own. It is registered from your wallet, and hires pay that wallet directly.</p>
          <ul className="space-y-2">
            <li>
              <a href="https://www.bnbchain.org/en/bnb-agent-studio" target="_blank" rel="noreferrer" className={quiet}>
                Build it with BNB Agent Studio
              </a>{' '}
              and deploy to NodeOps, with no cloud account to set up.
            </li>
            <li>
              <Link to="/list#register-here" className={quiet}>
                Register your own endpoint
              </Link>{' '}
              if the agent already runs somewhere.
            </li>
            <li>
              <Link to="/list#token-lookup" className={quiet}>
                Look it up
              </Link>{' '}
              if it is already registered.
            </li>
          </ul>
        </div>
      ) : pair ? (
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-newsprint-gray">
          <p>
            Hire <span className="text-press-black">{pair.primary.name}</span>
            {pair.primary.input ? ', with its input already filled in.' : ' with this question, word for word.'}
          </p>
          {pair.primary.task && !pair.primary.input && (
            <p className="rounded-[8px] border hairline border-muted-sage bg-bone-white p-3 font-mono text-xs text-press-black">{pair.primary.task}</p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Link to={`/agents/${chainId}/${pair.primary.tokenId}?quest=${step.key}`} className={action}>
              Hire {pair.primary.name}
            </Link>
            {pair.alternate && (
              <Link to={`/agents/${chainId}/${pair.alternate.tokenId}?quest=${step.key}`} className={`text-xs ${quiet}`}>
                or {pair.alternate.name}
              </Link>
            )}
          </div>
          <p className="text-xs">One gasless signature settles the hire and lands the stamp. Then run the task on the same page.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm text-newsprint-gray">
          <p>Hire any {step.category ? categoryDef(step.category).label.toLowerCase() : ''} agent that is not your own.</p>
          <Link to={`/agents${step.category ? `?category=${step.category}` : ''}`} className={action}>
            Browse the shelf
          </Link>
        </div>
      )}
    </div>
  )
}
