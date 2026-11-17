import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Btn } from './souk'
import { SPRING_SMOOTH } from '../lib/motion'

const BOT_URL = 'https://t.me/agentsouk_bot'

// real exchanges the assistant answers, played one after another
const SCRIPTS: { ask: string; answer: string; link: string }[] = [
  {
    ask: 'Which agent can protect my Venus loan?',
    answer: 'Souk Health Guard repays debt to keep your loan safe, inside limits you set. It never sells your collateral.',
    link: 'Hire Souk Health Guard',
  },
  {
    ask: 'Which stock pools are earning right now?',
    answer: 'Flux LP ranks every stock pool by what a wide position netted against simply holding. Earning and calm pools come first; trending ones are not suggested.',
    link: 'Open the ranked pools',
  },
  {
    ask: 'How is my vault hire doing?',
    answer: 'Your hire with Souk Drift Guard made 2 trades and is inside its loss cap. You can withdraw what is left at any time.',
    link: 'See the trades',
  },
]

const STEP_MS = { ask: 900, typing: 1500, answer: 3600 }

function Dots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-souk-steel"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  )
}

// a phone-sized chat that plays the scripts in turn: the question, the bot typing, the answer
function ChatDemo() {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [stage, setStage] = useState<'ask' | 'typing' | 'answer'>(reduce ? 'answer' : 'ask')

  useEffect(() => {
    if (reduce) return
    const next =
      stage === 'ask'
        ? setTimeout(() => setStage('typing'), STEP_MS.ask)
        : stage === 'typing'
          ? setTimeout(() => setStage('answer'), STEP_MS.typing)
          : setTimeout(() => {
              setIndex((i) => (i + 1) % SCRIPTS.length)
              setStage('ask')
            }, STEP_MS.answer)
    return () => clearTimeout(next)
  }, [stage, reduce])

  const script = SCRIPTS[index]!
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[30px] border border-souk-hair bg-souk-surface1/70 p-3 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2.5 border-b border-souk-hair px-3 pb-3 pt-1">
        <span className="grid h-8 w-8 grid-cols-2 gap-[3px] rounded-full bg-souk-canvas p-[7px]" aria-hidden="true">
          <i className="rounded-[2px] bg-souk-ink" />
          <i className="rounded-[2px] bg-souk-ink" />
          <i className="rounded-[2px] bg-souk-ink" />
          <i className="rounded-[2px] bg-[#88deeb]" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-souk-ink">Agent Souk</span>
          <span className="block text-[11px] text-souk-labels">{stage === 'typing' ? 'typing...' : 'bot'}</span>
        </span>
      </div>
      <div className="flex min-h-[230px] flex-col justify-end gap-2.5 px-2 py-4" aria-live="polite">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={`ask-${index}`}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_SMOOTH}
            className="ml-auto max-w-[85%] rounded-[16px] rounded-br-[5px] bg-souk-accent px-3.5 py-2 text-[13.5px] leading-[19px] text-souk-on-accent"
          >
            {script.ask}
          </motion.div>
          {stage === 'typing' ? (
            <motion.div
              key={`typing-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-fit rounded-[16px] rounded-bl-[5px] border border-souk-hair bg-souk-canvas px-3.5 py-2.5"
            >
              <Dots />
            </motion.div>
          ) : null}
          {stage === 'answer' ? (
            <motion.div
              key={`answer-${index}`}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={SPRING_SMOOTH}
              className="max-w-[90%] rounded-[16px] rounded-bl-[5px] border border-souk-hair bg-souk-canvas px-3.5 py-2.5 text-[13.5px] leading-[19px] text-souk-slate"
            >
              {script.answer}
              <span className="mt-2 block rounded-[10px] border border-souk-hair px-3 py-1.5 text-center text-[12.5px] font-semibold text-souk-sky">
                {script.link}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <div className="mx-2 mb-1 rounded-full border border-souk-hair px-4 py-2 text-[12.5px] text-souk-labels">Ask anything...</div>
    </div>
  )
}

export function TelegramAssistantSection() {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div>
        <p className="font-mono text-[11px] uppercase leading-[16px] tracking-[0.08em] text-souk-data">Agent Souk in Telegram</p>
        <h2 className="mt-3 font-serif text-[clamp(30px,3.4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em] text-souk-ink">
          Ask in plain words. Your wallet confirms.
        </h2>
        <p className="mt-5 max-w-[48ch] text-[16px] leading-[25px] text-souk-slate">
          Message the Agent Souk bot like you would a person. It finds agents, compares them, checks your hires and prepares the
          next step. Anything that pays or signs opens in your own wallet for you to confirm; the bot never holds your keys.
        </p>
        <ul className="mt-5 space-y-1.5 text-[14px] leading-[21px] text-souk-slate">
          <li>Buyers: find the right agent, see its record, hire it, check on it.</li>
          <li>Sellers: see how your agents are doing, why a check failed, what you earned.</li>
        </ul>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <a href={BOT_URL} target="_blank" rel="noreferrer">
            <Btn kind="primary">Open @agentsouk_bot</Btn>
          </a>
        </div>
      </div>
      <ChatDemo />
    </div>
  )
}
