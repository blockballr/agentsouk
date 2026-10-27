import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import { visitSeed } from '../lib/rotation'
import { isOperatedByAgentSouk } from '../lib/first-party'
import { useConnectedAccount } from '../lib/use-connected-account'
import { hireErrorText } from '../lib/hire'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import {
  QUEST_STEPS,
  getQuestProgress,
  getQuestShelf,
  questPicks,
  readSeenStamps,
  rememberQuestProgress,
  requiredDone,
  stampsFrom,
  writeQuestMode,
  writeSeenStamps,
  type QuestAgent,
  type QuestProgress,
  type QuestShelf,
  type QuestStep,
  type StepKey,
} from '../lib/quest'

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

// where a quester enters the campaign; BNB counts only the wallet given on its form
const BNB_CAMPAIGN = 'https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn?tab=overview'
const REFRESH_MS = 60_000

// a declared price can run to a paragraph, so the card names its first clause and
// nothing else. A listing that only quotes says so rather than borrowing a number
function priceLine(price?: string | null): string {
  const text = (price ?? '').trim()
  if (!text) return 'quote at hire'
  const first = text.split(/\s+or\s+|,|;/)[0].trim()
  return first.length > 26 ? `${first.slice(0, 25)}...` : first
}

export function QuestPage() {
  // always call the hook: gating the call on import.meta.env.DEV changes the
  // hook order between the dev and production bundles
  const target = useTargetChain()
  const chainId = target?.chainId ?? null
  const wallet = useConnectedAccount()
  const [progress, setProgress] = useState<QuestProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const stamps = stampsFrom(progress)
  const open = QUEST_STEPS.filter((s) => !stamps[s.key])
  // the next thing to do is simply the first stamp still missing
  const next = open[0] ?? null
  const done = requiredDone(progress)
  // an agent already hired cannot be the next hire, so it is never offered again
  const hiredIds = new Set((progress?.hires ?? []).map((h) => String(h.tokenId)))
  const chainLine = target ? `${chainLabel(target.chainId)} chain ${target.chainId}` : 'reading the network'

  // the offer list a hire step's own card reads, worked out once so the card and the
  // picks table never name different agents for the same step
  const picksFor = (step: QuestStep): QuestAgent[] =>
    chainId !== null && step.category && shelf !== undefined
      ? questPicks(step, chainId, shelf?.[step.category], wallet, hiredIds)
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
    ? stepContent(next, Boolean(stamps[next.key]), picksFor(next), readingFor(next), onlyOursFor(next), chainId, wallet)
    : null
  const stripAction = strip?.actions[0] ?? null

  const writtenPicks = chainId === 97
    ? QUEST_STEPS.flatMap((step) => {
        const pair = step.agents?.[97]
        if (!pair) return []
        return [
          { key: `${step.key}-primary`, stepTitle: step.title, name: pair.primary.name, tokenId: pair.primary.tokenId, slot: 'primary', task: pair.primary.task, category: step.category ?? 'general', chainId: 97, imageUrl: undefined, price: pair.primary.price ?? null },
          ...(pair.alternate
            ? [{ key: `${step.key}-alternate`, stepTitle: step.title, name: pair.alternate.name, tokenId: pair.alternate.tokenId, slot: 'alternate', task: pair.alternate.task, category: step.category ?? 'general', chainId: 97, imageUrl: undefined, price: pair.alternate.price ?? null }]
            : []),
        ]
      })
    : []
  // other working hirable agents from the shelf across the four categories
  const shelfPicks = shelf
    ? Object.entries(shelf).flatMap(([cat, s]) => (s?.working ?? []).map((a) => ({
        key: `shelf-${a.tokenId}`,
        stepTitle: 'Other pick',
        name: a.name,
        tokenId: a.tokenId,
        slot: 'primary' as const,
        task: undefined,
        category: cat,
        chainId: chainId ?? 97,
        imageUrl: a.imageUrl,
        price: a.price ?? null,
      })))
    : []
  const otherPicks = [...shelfPicks, ...writtenPicks.filter((w) => !shelfPicks.some((s) => s.tokenId === w.tokenId))]
  // arrange into the four categories, one pick per category (job-capable preferred)
  const CATEGORY_ORDER = ['health-factor', 'grid-trading', 'rebalancing', 'yield']
  const CATEGORY_LABEL: Record<string, string> = {
    'health-factor': 'Health factor',
    'grid-trading': 'Grid trading',
    'rebalancing': 'Rebalancing',
    'yield': 'Yield',
  }
  const picksByCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    label: CATEGORY_LABEL[cat],
    picks: otherPicks.filter((p) => p.category === cat).slice(0, 2),
  }))

  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="px-4 lg:px-8 pb-28 pt-10 lg:pb-16">
        <Stack gap={10}>
          <Txt size={11} lead={16} mono upper tone="data">
            {`Set and Earn · wallet ${wallet ? shortAddress(wallet) : 'not connected'} · ${chainLine}`}
          </Txt>
          <h1 className="font-serif text-[34px] font-bold leading-[42px] text-souk-ink">Set and Earn Quest.</h1>
          <p className="max-w-[1180px] text-[15px] leading-[23px] text-souk-slate">
            Set and Earn needs 3 different agents across at least 2 shortlisted marketplaces, plus one
            agent of your own listed. This page tracks the Agent Souk side: your hires here and your
            listing. A passport stamp needs two hires here, but one hire here and two elsewhere also
            counts for the campaign.
          </p>
        </Stack>

        {/* the reminder comes first: a hire from any other wallet is not counted by the campaign */}
        <Section>
          <Row
            bg="indigo"
            hair
            pad={[14, 16, 14, 16]}
            gap={12}
            align="center"
            justify="between"
            className="flex-wrap gap-y-3"
          >
            <Row gap={10} align="center" className="min-w-[320px] flex-1">
              <Dot tone="good" size={8} />
              {/* the band is indigo in both registers, so its ink and sky would
                  land as navy and teal on paper: the line and its link wear white */}
              <Txt size={13} lead={20} tone="white" className="max-w-[1180px]">
                Take part with the wallet you entered on{' '}
                <a
                  href={BNB_CAMPAIGN}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-white/40 underline-offset-2 hover:decoration-white"
                >
                  BNB Chain&apos;s Set and Earn form
                </a>
                . BNB Chain counts no other wallet, so a hire made from any other one earns nothing here.
              </Txt>
            </Row>
            <Row gap={8} align="center">
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

        <Section pad="pt-3 pb-4 md:pt-4 md:pb-6">
          <Stack surface pad={[20, 22, 20, 22]} gap={14}>
            <SectionHead title="Your standing" note="SETTLED HIRES AND LISTINGS ONLY" />
            <Row gap={10}>
              <Stack pad={[10, 12, 10, 12]} gap={2} bg="surface2" radius={8} className="min-w-0 flex-1">
                <Txt size={16} lead={22} mono tone="steel">{`${done} of 3`}</Txt>
                <Label tone="muted">To finish</Label>
              </Stack>
              <Stack pad={[10, 12, 10, 12]} gap={2} bg="surface2" radius={8} className="min-w-0 flex-1">
                <Txt size={16} lead={22} mono tone="steel" className="truncate">
                  {wallet ? shortAddress(wallet) : 'no wallet yet'}
                </Txt>
                <Label tone="muted">Wallet</Label>
              </Stack>
            </Row>
            {/* the bar counts the stamps, which is the only thing the passport tallies now */}
            <div
              className="h-1.5 overflow-hidden rounded-[3px] bg-souk-hair"
              role="progressbar"
              aria-label="Quest stamps"
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={done}
            >
              <div
                className="meter-fill relative h-full overflow-hidden rounded-[3px] bg-souk-data transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${(done / 3) * 100}%` }}
              >
                {done < 3 ? (
                  <span
                    aria-hidden="true"
                    className="meter-shimmer absolute inset-y-0 left-0 w-[40%] rounded-[3px] bg-gradient-to-r from-transparent via-white/70 to-transparent"
                  />
                ) : null}
              </div>
            </div>
            <Rule hair />
            {/* the next move lives with the standing it follows from, rather than in a
                second panel above it that repeats the step card below */}
            <Row justify="between" align="start" gap={14}>
              <Stack gap={5} className="min-w-0 flex-1">
                <Label tone="muted">
                  {next ? `Next: ${next.title}` : 'Passport complete'}
                </Label>
                <Txt size={13} lead={20} tone="ink">
                  {strip ? strip.instruction : 'Every step that finishes the passport is in.'}
                </Txt>
                {stripAction ? (
                  stripAction.to ? (
                    <Link to={stripAction.to} className="inline-block">
                      <Btn kind={stripAction.label.toLowerCase().includes('wallet') ? 'primary' : 'off'}>
                        {stripAction.label}
                      </Btn>
                    </Link>
                  ) : (
                    <Btn
                      kind={stripAction.label.toLowerCase().includes('wallet') ? 'primary' : 'off'}
                      onClick={stripAction.onClick}
                      disabled={stripAction.disabled}
                      className="self-start"
                    >
                      {stripAction.label}
                    </Btn>
                  )
                ) : null}
              </Stack>
              <QuestStamp
                step={next ? next.key : 'seal'}
                stamped={next ? stamps[next.key] : true}
                className="w-[84px] shrink-0"
              />
            </Row>
            <Rule hair />
            <Txt size={12} lead={18} tone="muted">
              Any agent on the market counts for a hire, as long as it is not your own and not one you already hired.
            </Txt>
          </Stack>
        </Section>

        <Section pad="pt-4 pb-16 md:pt-6 md:pb-18">
          <SectionHead title={`${QUEST_STEPS.length} steps`} note="ONE STAMP EACH" />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {QUEST_STEPS.map((step, i) => (
              <StepCard
                key={step.key}
                step={step}
                number={i + 1}
                stamped={stamps[step.key]}
                fresh={fresh.includes(step.key)}
                isNext={next?.key === step.key}
                picks={picksFor(step)}
                reading={readingFor(step)}
                onlyOurs={onlyOursFor(step)}
                chainId={chainId}
                wallet={wallet}
              />
            ))}

          </div>
        </Section>

        <section className="mt-10">
          <Stack surface>
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
            <SectionHead title="Other picks to choose from" note="NAMED IN THE PRODUCT" />
            {picksByCategory.map(({ cat, label, picks }) => (
              <div key={cat} className="space-y-2">
                <Txt size={11} lead={14} weight="bold" upper tone="muted">{label}</Txt>
                {picks.length === 0 ? (
                  <Txt size={12} lead={18} tone="steel">No agent on the shelf yet.</Txt>
                ) : (
                  picks.map((w) => (
                    <Link key={w.key} to={`/agents/${w.chainId ?? 97}/${w.tokenId}`} className="block transition hover:opacity-80">
                      <div>
                        <Row gap={12} align="center" justify="between">
                          <Row gap={11} align="center" className="min-w-0">
                            <AgentAvatar size={34} name={w.name} imageUrl={w.imageUrl} chainId={w.chainId} tokenId={w.tokenId} />
                            <Stack gap={2} className="min-w-0">
                              <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">{w.name}</Txt>
                              <Txt size={11} lead={15} mono tone="labels">{`token ${w.tokenId} · ${w.slot}`}</Txt>
                            </Stack>
                          </Row>
                          <Stack gap={3} className="shrink-0 text-right">
                            {/* the seller's own words for its price; a listing that only quotes
                                does not get a number printed next to it */}
                            <Txt size={11} lead={14} mono tone="data">{priceLine(w.price)}</Txt>
                            <Txt size={11} lead={14} weight="bold" upper tone="ink">Hire</Txt>
                          </Stack>
                        </Row>
                        {w.task ? (
                          <Txt size={12} lead={18} tone="steel" className="mt-2 block pl-[45px]">
                            {w.task}
                          </Txt>
                        ) : null}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            ))}
          </Stack>
          <Stack surface pad={[20, 22, 20, 22]} gap={12} className="min-w-0 self-start">
            <SectionHead title="What it finishes into" note="THE GRAND SEAL" />
            <Row justify="center">
              <QuestStamp step="seal" stamped={Boolean(progress?.completed)} className="w-[92px]" />
            </Row>
            <Row gap={12} align="start">
              <Txt size={10} lead={16} weight="bold" upper tone="muted" className="w-[128px] shrink-0">
                Passport number
              </Txt>
              <Txt
                size={12}
                lead={18}
                mono
                tone="steel"
                className="min-w-0 flex-1 [overflow-wrap:anywhere]"
              >
                {progress?.passport?.serial ?? 'not issued yet'}
              </Txt>
            </Row>
          </Stack>
        </div>

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
): { title: string; instruction: string; actions: StepAction[] } {
  const title = step.key === 'stall' ? 'List your agent' : step.title
  if (stamped) {
    const what = step.key === 'stall' ? 'Your listed agent is counted.' : 'Your settled hire is counted.'
    return { title, instruction: `Stamped. ${what}`, actions: [] }
  }
  // BNB counts only the wallet a quester entered on its form, so the first card says so
  const first = step.key === 'first'
  if (!wallet) {
    return {
      title,
      instruction: first
        ? 'Connect the wallet you entered on BNB Chain\'s Set and Earn form, from the rail on the left.'
        : 'Connect from the rail on the left to hire.',
      actions: [],
    }
  }
  if (step.key === 'stall') {
    return {
      title,
      instruction: 'List one agent of your own. Its hires pay your wallet directly.',
      actions: [{ label: 'List your agent', to: '/list?quest=stall' }],
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
          : 'One signature settles the hire.',
      actions: picks.map((a) => ({
        label: `Hire ${a.name}`,
        to: `/agents/${chainId}/${a.tokenId}?quest=${step.key}`,
      })),
    }
  }
  if (onlyOurs) {
    return {
      title,
      instruction: 'Only our own agents answer in this category, and hiring your own listing does not count.',
      actions: [],
    }
  }
  return {
    title,
    instruction: 'No escrow agent in this category is answering just now. Refresh in a moment to see who is.',
    actions: [],
  }
}

// every step is built from the same parts in the same order, so the passport reads as one grid
// and the actions line up along the bottom of every card
function StepCard({
  step,
  number,
  stamped,
  fresh,
  isNext,
  picks,
  reading,
  onlyOurs,
  chainId,
  wallet,
}: {
  step: QuestStep
  number: number
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
}) {
  const { title, instruction, actions } = stepContent(step, stamped, picks, reading, onlyOurs, chainId, wallet)
  const state = stamped ? 'Stamped' : isNext ? 'Next up' : 'Not stamped yet'
  return (
    <article
      aria-label={`${title}, ${state.toLowerCase()}`}
      className="relative flex h-full min-w-0 flex-col gap-3 overflow-hidden rounded-none border border-souk-edge bg-souk-surface1 [overflow-wrap:anywhere]"
      style={{ padding: '20px 22px' }}
    >
      <QuestStamp
        step={step.key}
        stamped={stamped}
        press={fresh}
        className="pointer-events-none absolute right-3 top-3 w-[104px]"
      />
      {/* the heading keeps clear of the stamp in the corner */}
      <Stack gap={4} className="pr-[100px]">
        <Txt size={10} lead={14} weight="bold" upper tone="muted">
          {`Step ${number}`}
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
      <div className="mt-auto grid gap-2">
        {actions.map((a) =>
          a.to ? (
            <Link key={a.label} to={a.to} className="block min-w-0">
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
              className="w-full min-w-0"
            >
              <span className="block min-w-0 truncate" title={a.label}>{a.label}</span>
            </Btn>
          ),
        )}
      </div>
    </article>
  )
}
