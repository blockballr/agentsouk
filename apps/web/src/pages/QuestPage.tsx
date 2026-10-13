import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import { visitSeed } from '../lib/rotation'
import { isOperatedByAgentSouk } from '../lib/first-party'
import { connectWallet, getActiveAccount } from '../lib/wallet'
import { hireErrorText } from '../lib/hire'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import {
  QUEST_STEPS,
  getQuestProgress,
  getQuestShelf,
  questPicks,
  rankFor,
  readSeenPoints,
  readSeenStamps,
  rememberQuestProgress,
  requiredDone,
  stampsFrom,
  writeQuestMode,
  writeSeenPoints,
  writeSeenStamps,
  type QuestAgent,
  type QuestProgress,
  type QuestShelf,
  type QuestStep,
  type StepKey,
} from '../lib/quest'
import { cx } from '../components/ui'
import {
  Stack,
  Row,
  Txt,
  Pill,
  Dot,
  SectionHead,
  NoteBox,
  DataTable,
  Btn,
  Rule,
  Label,
  AgentAvatar,
  Section,
} from '../components/souk'
import { QuestStamp } from '../components/QuestStamp'
import { ShareCard } from '../components/ShareCard'
import { SPECIMEN_SERIAL } from '../lib/share-card'

const TOTAL = 1000
// where a quester enters the campaign; BNB counts only the wallet given on its form
const BNB_CAMPAIGN = 'https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn?tab=overview'
// which of the server's awards pays each step
const AWARD_KEY: Record<StepKey, string> = { first: 'hire-1', stall: 'listing', second: 'hire-2', third: 'hire-3', seal: 'bonus' }
// the specimen is drawn for the connected wallet, or for this address when there is none
const SPECIMEN_HOLDER = '0x4bb30e3b3bc22082c1935fe3be7c07448e69c862'
const REFRESH_MS = 30_000

export function QuestPage() {
  const navigate = useNavigate()
  // always call the hook: gating the call on import.meta.env.DEV changes the
  // hook order between the dev and production bundles
  const location = useLocation()
  const specimen = import.meta.env.DEV && new URLSearchParams(location.search).has('specimen')
  const target = useTargetChain()
  const chainId = target?.chainId ?? null
  const [wallet, setWallet] = useState<string | null>(null)
  const [progress, setProgress] = useState<QuestProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [shownPoints, setShownPoints] = useState(0)
  const counted = useRef(false)
  const [fresh, setFresh] = useState<StepKey[]>([])
  // who each hire step may offer, in the order the shelf rotated them for this visit: undefined
  // while it is being read, null when it could not be, so a button never changes its target
  const [shelf, setShelf] = useState<Record<string, QuestShelf> | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    getQuestShelf(visitSeed())
      .then((s) => {
        if (live) setShelf(s)
      })
      .catch(() => {
        if (live) setShelf(null)
      })
    return () => {
      live = false
    }
  }, [])

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

  // a stamp this browser has not shown yet comes down on the page; the rest are simply there.
  // Worked out before the page is painted, so a new stamp is never shown at rest first
  useLayoutEffect(() => {
    if (!wallet || !progress) return
    const earned = stampsFrom(progress)
    const keys = QUEST_STEPS.map((s) => s.key).filter((k) => earned[k])
    const seen = readSeenStamps(wallet)
    const unseen = keys.filter((k) => !seen.includes(k))
    if (unseen.length === 0) return
    setFresh((f) => [...new Set([...f, ...unseen])])
    writeSeenStamps(wallet, keys)
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
  const open = QUEST_STEPS.filter((s) => s.key !== 'seal' && !stamps[s.key])
  // what the passport needs comes before the extra hire
  const next = open.find((s) => !s.optional) ?? open[0] ?? null
  const points = progress?.points ?? 0
  const rank = rankFor(points)
  const done = requiredDone(progress)
  // a stamped card shows what the server awarded, an open one what the step is worth
  const awarded = new Map((progress?.awards ?? []).map((a) => [a.key, a.points]))
  const pointsFor = (step: QuestStep): number => awarded.get(AWARD_KEY[step.key]) ?? step.points
  // an agent already hired cannot be the next hire, so it is never offered again
  const hiredIds = new Set((progress?.hires ?? []).map((h) => h.tokenId))
  const sealStep = QUEST_STEPS.find((s) => s.key === 'seal')
  const chainLine = target ? `${chainLabel(target.chainId)} chain ${target.chainId}` : 'reading the network'

  // the offer list a hire step's own card reads, worked out once so the card and the
  // picks table never name different agents for the same step
  const picksFor = (step: QuestStep): QuestAgent[] =>
    chainId !== null && step.category && shelf !== undefined
      ? questPicks(step, chainId, shelf?.[step.category], wallet).filter((a) => !hiredIds.has(a.tokenId))
      : []
  const readingFor = (step: QuestStep): boolean =>
    Boolean(step.category) && (shelf === undefined || chainId === null)
  const onlyOursFor = (step: QuestStep): boolean =>
    Boolean(step.category && shelf?.[step.category]?.working.length && shelf[step.category].working.every((a) => isOperatedByAgentSouk(a.owner)))

  // the shelf table reads the same payload the cards do, plus any category the server
  // carries that no step points at, which is said in words rather than as a step
  const countFor = (category: string, list: 'confirmed' | 'working'): string => {
    if (shelf === undefined) return 'reading'
    if (shelf === null) return 'unknown'
    return String(shelf[category]?.[list].length ?? 0)
  }
  const totalFor = (category: string): string => {
    if (shelf === undefined) return 'reading'
    if (shelf === null) return 'unknown'
    const s = shelf[category]
    return `${(s?.confirmed.length ?? 0) + (s?.working.length ?? 0)} agents`
  }
  const pickRows = [
    ...QUEST_STEPS.filter((s) => s.category).map((step) => {
      const category = step.category as string
      const picks = chainId !== null && shelf !== undefined ? picksFor(step) : []
      const offers = readingFor(step)
        ? 'Reading which agents are answering right now.'
        : picks.length > 0
          ? picks.map((a) => a.name).join(' · ')
          : 'Points at the shelf.'
      return {
        cells: [
          { text: step.title, weight: 'semibold' as const, tone: 'ink' as const },
          { text: category, mono: true, tone: 'slate' as const },
          { text: countFor(category, 'confirmed'), mono: true, tone: 'steel' as const },
          { text: countFor(category, 'working'), mono: true, tone: 'steel' as const },
          { text: totalFor(category), mono: true, tone: 'steel' as const },
          { text: offers, tone: 'steel' as const },
        ],
      }
    }),
    ...(shelf
      ? Object.keys(shelf)
          .filter((category) => !QUEST_STEPS.some((s) => s.category === category))
          .map((category) => ({
            cells: [
              { text: 'no step', tone: 'muted' as const },
              { text: category, mono: true, tone: 'slate' as const },
              { text: countFor(category, 'confirmed'), mono: true, tone: 'steel' as const },
              { text: countFor(category, 'working'), mono: true, tone: 'steel' as const },
              { text: totalFor(category), mono: true, tone: 'steel' as const },
              { text: 'Nothing points here today.', tone: 'steel' as const },
            ],
          }))
      : []),
  ]

  // the strip names the one thing to do now, read from the same step content the card below
  // uses, so the strip and the card never disagree about what the next move is
  const strip = next
    ? stepContent(next, Boolean(stamps[next.key]), picksFor(next), readingFor(next), onlyOursFor(next), chainId, wallet, connect, connecting)
    : null
  const stripAction = strip?.actions[0] ?? null

  const writtenPicks = QUEST_STEPS.flatMap((step) => {
    const pair = step.agents?.[97]
    if (!pair) return []
    return [
      { key: `${step.key}-primary`, stepTitle: step.title, name: pair.primary.name, tokenId: pair.primary.tokenId, slot: 'primary', task: pair.primary.task },
      ...(pair.alternate
        ? [{ key: `${step.key}-alternate`, stepTitle: step.title, name: pair.alternate.name, tokenId: pair.alternate.tokenId, slot: 'alternate', task: pair.alternate.task }]
        : []),
    ]
  })

  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-8 pb-28 pt-10 lg:pb-16">
        <Stack gap={10}>
          <Txt size={11} lead={16} mono upper tone="data">
            {`Set and Earn · wallet ${wallet ? shortAddress(wallet) : 'not connected'} · ${chainLine}`}
          </Txt>
          <h1 className="font-serif text-[34px] font-bold leading-[42px] text-souk-ink">Souk passport.</h1>
          <p className="max-w-[1180px] text-[15px] leading-[23px] text-souk-slate">
            Hire an agent, list one of your own, then hire a second. That finishes your passport. A third hire is an
            extra, for more points.
          </p>
        </Stack>

        {/* the reminder comes first: a hire from any other wallet is not counted by the campaign */}
        <Section>
          <Row
            bg="indigo"
            hair
            radius={8}
            pad={[14, 16, 14, 16]}
            gap={12}
            align="center"
            justify="between"
            className="flex-wrap gap-y-3"
          >
            <Row gap={10} align="center" className="min-w-[320px] flex-1">
              <Dot tone="sky" size={8} />
              <Txt size={13} lead={20} tone="ink" className="max-w-[1180px]">
                Take part with the wallet you entered on{' '}
                <a
                  href={BNB_CAMPAIGN}
                  target="_blank"
                  rel="noreferrer"
                  className="text-souk-sky underline decoration-souk-sky/40 underline-offset-2 hover:decoration-souk-sky"
                >
                  BNB Chain&apos;s Set and Earn form
                </a>
                . BNB Chain counts no other wallet, so a hire made from any other one earns nothing here.
              </Txt>
            </Row>
            <Row gap={8} align="center">
              {!wallet ? (
                <Btn kind="primary" onClick={connect} disabled={connecting}>
                  {connecting ? 'Waiting for your wallet' : 'Connect wallet'}
                </Btn>
              ) : null}
              <a href={BNB_CAMPAIGN} target="_blank" rel="noreferrer">
                <Btn>Open the form</Btn>
              </a>
            </Row>
          </Row>
        </Section>

        {error ? (
          <Section>
            <div role="alert">
              <NoteBox title="The passport could not be read just now" copy={error} />
            </div>
          </Section>
        ) : null}

        <Section>
          <Stack surface pad={[20, 22, 20, 22]} gap={14}>
            <SectionHead title="Your standing" note="SETTLED HIRES AND LISTINGS ONLY" />
            <Row gap={10}>
              <Stack pad={[10, 12, 10, 12]} gap={2} bg="surface2" radius={8} className="min-w-0 flex-1">
                <Txt size={16} lead={22} mono tone="steel">{`${done} of 3`}</Txt>
                <Label tone="muted">To finish</Label>
              </Stack>
              <Stack pad={[10, 12, 10, 12]} gap={2} bg="surface2" radius={8} className="min-w-0 flex-1">
                <Txt size={16} lead={22} mono tone="steel">{rank.title}</Txt>
                <Label tone="muted">Titled</Label>
              </Stack>
            </Row>
            <Stack gap={8}>
              <Row justify="between" align="center" gap={12}>
                <Label tone="muted">Passport points</Label>
                <Txt size={14} lead={18} mono tone={points > 0 ? 'data' : 'steel'}>
                  {`${shownPoints.toLocaleString()} of ${TOTAL.toLocaleString()}`}
                </Txt>
              </Row>
              <Row justify="between" align="center" gap={12} className="flex-wrap">
                <Txt size={12} lead={18} tone="steel">
                  {rank.next ? `${(rank.next.at - points).toLocaleString()} to ${rank.next.title}` : 'Every title earned'}
                </Txt>
                <Txt size={12} lead={18} mono tone="labels">
                  {wallet ? `wallet ${shortAddress(wallet)}` : 'no wallet yet'}
                </Txt>
              </Row>
              <div
                className="h-1.5 overflow-hidden rounded-[3px] bg-souk-hair"
                role="progressbar"
                aria-label="Quest points"
                aria-valuemin={0}
                aria-valuemax={TOTAL}
                aria-valuenow={points}
              >
                <div
                  className="h-full rounded-[3px] bg-souk-data"
                  style={{ width: `${Math.min(100, (shownPoints / TOTAL) * 100)}%` }}
                />
              </div>
              <Txt size={12} lead={18} tone="steel">
                A step stamps once its hire has settled or its listing is on the shelf.
              </Txt>
            </Stack>
            <Rule hair />
            <Txt size={12} lead={18} tone="muted">
              Any agent on the market counts for a hire, as long as it is not your own and not one you already hired.
              Points and titles track your progress here and are not a token or a reward.
            </Txt>
          </Stack>
        </Section>

        <Section>
          <SectionHead title={`${QUEST_STEPS.length} steps, three of them finish it`} note="ONE STAMP EACH" />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {QUEST_STEPS.map((step, i) => (
              <StepCard
                key={step.key}
                step={step}
                number={i + 1}
                points={pointsFor(step)}
                stamped={stamps[step.key]}
                fresh={fresh.includes(step.key)}
                isNext={next?.key === step.key}
                picks={picksFor(step)}
                reading={readingFor(step)}
                onlyOurs={onlyOursFor(step)}
                chainId={chainId}
                wallet={wallet}
                onConnect={connect}
                connecting={connecting}
              />
            ))}
            <Stack hair radius={20} pad={[20, 22, 20, 22]} gap={10} className="min-w-0">
              <Txt size={15} lead={22} weight="bold" tone="ink">What counts</Txt>
              <Txt size={12} lead={18} tone="slate">
                Any agent on the market counts for a hire, as long as it is not your own and not one you already hired.
                Points and titles track your progress here and are not a token or a reward.
              </Txt>
              <Txt size={12} lead={18} tone="muted">
                The passport, its points and its titles are ours. The merch is BNB Chain&apos;s, and its rules ask for
                three hires across at least two marketplaces, so one of yours has to be made somewhere else.
              </Txt>
              <Rule hair />
              <Btn onClick={quit} className="w-full">Quit the quest</Btn>
            </Stack>
          </div>
        </Section>

        <Section>
          <div className="grid gap-5">
            {wallet && progress?.completed ? (
              <ShareCard
                rank={rank.title}
                points={points}
                wallet={wallet}
                serial={progress.passport?.serial}
                issuedAt={progress.passport?.issuedAt}
                thirdHire={stamps.third}
              />
            ) : null}
            {/* the card for the announcement, numbered ahead of every holder's; local builds only */}
            {specimen ? (
              <ShareCard rank={rankFor(TOTAL).title} points={TOTAL} wallet={wallet ?? SPECIMEN_HOLDER} serial={SPECIMEN_SERIAL} thirdHire />
            ) : null}
          </div>
        </Section>

        <section className="mt-10">
          <SectionHead title="What the shelf is offering" note="READ FROM /api/quest/picks" />
          <Stack surface className="mt-5">
            <div className="overflow-x-auto">
              <div style={{ minWidth: 1200 }}>
                <DataTable
                  cols={[220, 250, 190, 190, 250, 756]}
                  header={[
                    'STEP',
                    'CATEGORY',
                    'CONFIRMED',
                    'ANSWERING',
                    target ? `SHELF ON ${chainLabel(target.chainId)} ${target.chainId}` : 'SHELF',
                    'WHAT THE STEP OFFERS',
                  ]}
                  rows={pickRows}
                />
              </div>
            </div>
          </Stack>
        </section>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <Stack surface pad={[20, 22, 20, 22]} gap={12} className="min-w-0 lg:col-span-2">
            <SectionHead title="The picks the quest is written with" note="BNB 97 · NAMED IN THE PRODUCT" />
            {writtenPicks.map((w) => (
              <div key={w.key}>
                <Row gap={12} align="center" justify="between">
                  <Row gap={11} align="center" className="min-w-0">
                    <AgentAvatar size={34} name={w.name} />
                    <Stack gap={2} className="min-w-0">
                      <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">{w.name}</Txt>
                      <Txt size={11} lead={15} mono tone="labels">{`BNB 97 · token ${w.tokenId} · ${w.slot}`}</Txt>
                    </Stack>
                  </Row>
                  <Pill variant="off">{w.stepTitle}</Pill>
                </Row>
                {w.task ? (
                  <Txt size={12} lead={18} tone="steel" className="mt-2 block pl-[45px]">
                    {w.task}
                  </Txt>
                ) : null}
              </div>
            ))}
            <Txt size={12} lead={18} tone="steel">
              {target
                ? `On ${chainLabel(target.chainId)} a hire step gets its offers from the shelf; on BNB 97 these are the agents the steps name outright.`
                : 'On the connected chain a hire step gets its offers from the shelf; on BNB 97 these are the agents the steps name outright.'}
            </Txt>
          </Stack>
          <Stack surface pad={[20, 22, 20, 22]} gap={12} className="min-w-0">
            <SectionHead title="What it finishes into" note="THE GRAND SEAL" />
            <Row justify="center">
              <QuestStamp step="seal" stamped={Boolean(progress?.completed)} className="w-[92px]" />
            </Row>
            {sealStep
              ? (
                  [
                    { k: 'The seal', v: `+${sealStep.points} points, once the rest is in`, mono: false },
                    { k: 'Passport number', v: progress?.passport?.serial ?? 'not issued yet', mono: true },
                    { k: 'Share card', v: progress?.completed ? 'drawn above' : 'not drawn yet', mono: true },
                  ] as const
                ).map(({ k, v, mono }) => (
                  <Row key={k} gap={12} align="start">
                    <Txt size={10} lead={16} weight="bold" upper tone="muted" className="w-[128px] shrink-0">
                      {k}
                    </Txt>
                    <Txt
                      size={12}
                      lead={18}
                      mono={mono}
                      tone={mono ? 'steel' : 'slate'}
                      className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                    >
                      {v}
                    </Txt>
                  </Row>
                ))
              : null}
          </Stack>
        </div>

        <Stack surface pad={[16, 22, 16, 22]} gap={10} className="mt-8">
          <SectionHead title="The strip that brings you here" note="CARRIED ON THE PAGES A STEP SENDS YOU TO" />
          <Row justify="between" align="start" gap={14}>
            <Stack gap={6} className="min-w-0 flex-1">
              <Txt size={10} lead={14} weight="bold" upper tone="muted">
                {`Souk passport · ${strip && next ? next.title : 'complete'}`}
              </Txt>
              <Txt size={13} lead={20} tone="slate">
                {strip ? strip.instruction : 'Every step that finishes the passport is in.'}
              </Txt>
            </Stack>
            <QuestStamp step={next ? next.key : 'seal'} stamped={next ? stamps[next.key] : true} className="w-[104px] shrink-0" />
          </Row>
          {stripAction ? (
            stripAction.to ? (
              <Link to={stripAction.to} className="mt-1 inline-block">
                <Btn>{stripAction.label}</Btn>
              </Link>
            ) : (
              <Btn onClick={stripAction.onClick} disabled={stripAction.disabled} className="mt-1">
                {stripAction.label}
              </Btn>
            )
          ) : null}
        </Stack>

        <div className="mt-10 pb-2">
          <Rule />
          <Txt size={11} lead={17} mono tone="muted" className="mt-3 block uppercase">
            A stamp is earned by settled activity.
          </Txt>
        </div>
      </div>
    </div>
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
  picks: QuestAgent[],
  reading: boolean,
  onlyOurs: boolean,
  chainId: number | null,
  wallet: string | null,
  onConnect: () => void,
  connecting: boolean,
): { title: string; instruction: string; actions: StepAction[] } {
  const title = step.key === 'seal' ? 'The grand seal' : step.key === 'stall' ? 'Open your stall' : step.title
  if (stamped) {
    const what =
      step.key === 'seal'
        ? 'Two hires and your stall are in, with the finishing bonus.'
        : step.key === 'stall'
          ? 'Your listed agent is counted.'
          : 'Your settled hire is counted.'
    return { title, instruction: `Stamped. ${what}`, actions: [] }
  }
  if (step.key === 'seal') {
    return { title, instruction: 'Two hires and your stall land the grand seal, with the finishing bonus.', actions: [] }
  }
  // BNB counts only the wallet a quester entered on its form, so the first card says so
  const first = step.key === 'first'
  if (!wallet) {
    return {
      title,
      instruction: first
        ? 'Connect the wallet you entered on BNB Chain\'s Set and Earn form.'
        : 'Connect the wallet you will hire with to see its stamps.',
      actions: [{ label: connecting ? 'Waiting for your wallet' : 'Connect wallet', onClick: onConnect, disabled: connecting }],
    }
  }
  if (step.key === 'stall') {
    return {
      title,
      instruction: 'List one agent of your own. Its hires pay your wallet directly.',
      actions: [{ label: 'List an agent', to: '/list?quest=stall' }],
    }
  }
  if (reading) return { title, instruction: 'Reading which agents are answering right now.', actions: [] }
  if (picks.length > 0) {
    return {
      title,
      instruction: first
        ? 'Hire with the wallet on your Set and Earn form. One signature settles it.'
        : onlyOurs
          ? 'Only our own agents answer here today. One signature settles the hire.'
          : 'One signature settles the hire. Then run a task on its page.',
      actions: picks.map((a, i) => ({
        label: `${i === 0 ? 'Hire' : 'Or'} ${a.name}`,
        to: `/agents/${chainId}/${a.tokenId}?quest=${step.key}`,
      })),
    }
  }
  return {
    title,
    instruction: first
      ? 'Hire with the wallet on your Set and Earn form. Any agent but your own counts.'
      : 'Hire any agent that is not your own and that you have not hired yet.',
    actions: [{ label: 'Browse the shelf', to: '/agents?sort=reachability' }],
  }
}

// every step is built from the same parts in the same order, so the passport reads as one grid
// and the actions line up along the bottom of every card
function StepCard({
  step,
  number,
  points,
  stamped,
  fresh,
  isNext,
  picks,
  reading,
  onlyOurs,
  chainId,
  wallet,
  onConnect,
  connecting,
}: {
  step: QuestStep
  number: number
  points: number
  stamped: boolean
  // stamped since this browser last showed the passport
  fresh: boolean
  isNext: boolean
  picks: QuestAgent[]
  // the picks for this step are still being read
  reading: boolean
  // every agent answering in this step's category is one we run
  onlyOurs: boolean
  chainId: number | null
  wallet: string | null
  onConnect: () => void
  connecting: boolean
}) {
  const { title, instruction, actions } = stepContent(step, stamped, picks, reading, onlyOurs, chainId, wallet, onConnect, connecting)
  const state = stamped ? 'Stamped' : isNext ? 'Next up' : 'Not stamped yet'
  return (
    <article
      aria-label={`${title}, ${points} points, ${state.toLowerCase()}`}
      className="relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-[20px] border border-souk-edge bg-souk-surface1 [overflow-wrap:anywhere]"
      style={{ padding: '20px 22px' }}
    >
      <QuestStamp
        step={step.key}
        stamped={stamped}
        press={fresh}
        className={cx('pointer-events-none absolute right-3 top-3', step.key === 'seal' ? 'w-[80px]' : 'w-[104px]')}
      />
      {/* the heading keeps clear of the stamp in the corner */}
      <Stack gap={4} className="pr-[100px]">
        <Txt size={10} lead={14} weight="bold" upper tone="muted">
          {step.key === 'seal' ? 'Finish' : step.optional ? 'Extra' : `Step ${number}`} · +{points} points
        </Txt>
        <Txt size={20} lead={26} weight="bold" tone="ink" className="block truncate">{title}</Txt>
      </Stack>
      <Row justify="between" align="center" gap={9} className="flex-wrap pr-[100px]">
        <Row gap={9} align="center" className="min-w-0">
          <Dot tone={stamped ? 'good' : 'quiet'} size={8} />
          <Txt size={14} lead={20} tone={stamped || isNext ? 'ink' : 'slate'} className="truncate">{state}</Txt>
        </Row>
        {isNext ? <Pill variant="keep">Next up</Pill> : null}
      </Row>
      <Txt size={13} lead={20} tone="slate" className="block">{instruction}</Txt>
      <Rule hair />
      <div className="mt-auto grid grid-cols-2 gap-2">
        {actions.map((a) =>
          a.to ? (
            <Link key={a.label} to={a.to} className={cx('block min-w-0', actions.length === 1 && 'col-span-2')}>
              <Btn className="w-full">
                {/* an agent's name can be any length, so the label stays on one line */}
                <span className="block min-w-0 truncate" title={a.label}>{a.label}</span>
              </Btn>
            </Link>
          ) : (
            <Btn
              key={a.label}
              onClick={a.onClick}
              disabled={a.disabled}
              className={cx('w-full min-w-0', actions.length === 1 && 'col-span-2')}
            >
              <span className="block min-w-0 truncate" title={a.label}>{a.label}</span>
            </Btn>
          ),
        )}
      </div>
    </article>
  )
}
