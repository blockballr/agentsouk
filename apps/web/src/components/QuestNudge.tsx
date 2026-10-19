import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getQuestProgress,
  latestQuestProgress,
  questModeFor,
  rememberQuestProgress,
  requiredDone,
  subscribeQuest,
  writeQuestMode,
} from '../lib/quest'
import { sessionAccount } from '../lib/wallet-session'
import { hireErrorText } from '../lib/hire'
import { cx } from './ui'
import { Btn, Label, Row, Stack, Txt } from './souk'
import { motion, useReducedMotion } from 'framer-motion'

const REFRESH_MS = 30_000
// the tab lives in the persistent status bar; the card measures it so the
// minimize ends where the way back in actually sits
const QUEST_TAB_SELECTOR = '[data-quest-tab]'
type MinimizeTarget = { x: number; y: number; scaleX: number; scaleY: number }
// the way back into a started quest sits under the nav on every screen, in the primary
// colour, so it is the first thing seen and is small enough to cover nothing
// the invitation floats over the page, carrying its own background. on a wide screen it
// hangs under the page's first band, measured below; narrower than that the page's own
// header owns the top, so it stays at the foot and gives way to the compare bar
const INVITE =
  'fixed bottom-3 left-3 right-3 rounded-[20px] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[430px] xl:bottom-auto xl:top-[var(--quest-top)] [body:has([data-compare-bar])_&]:hidden xl:[body:has([data-compare-bar])_&]:block'

// the quest's one spot on the page: an invitation before it is started, then a way back in
// until it is finished. Never a blocking modal, and kept off agent pages, whose
// phone hire bar owns the bottom of the screen
export function QuestNudge() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [wallet, setWallet] = useState<string | null>(null)
  // nothing shows until the wallet has been looked up, or a returning quester would see the
  // invitation flash before their resume button
  const [walletKnown, setWalletKnown] = useState(false)
  const [, redraw] = useState(0)
  const lastRead = useRef(0)
  // a quest belongs to a wallet, so starting one asks for that wallet first
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minimized, setMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem('agentsouk.quest.minimized') === '1' } catch { return false }
  })
  const reducedMotion = useReducedMotion()
  const [minimizing, setMinimizing] = useState(false)
  const [minimizeTarget, setMinimizeTarget] = useState<MinimizeTarget | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // the way back in only exists while the card is minimized, so the card asks
  // the bar to show it, then measures it before the first keyframe
  useEffect(() => {
    if (!minimizing || minimizeTarget) return
    let raf = 0
    let tries = 0
    const measure = () => {
      const tab = document.querySelector<HTMLElement>(QUEST_TAB_SELECTOR)
      const card = cardRef.current
      if (tab && card) {
        const br = tab.getBoundingClientRect()
        const cr = card.getBoundingClientRect()
        setMinimizeTarget({
          x: br.left + br.width / 2 - (cr.left + cr.width / 2),
          y: br.top + br.height / 2 - (cr.top + cr.height / 2),
          scaleX: Math.max(0.02, br.width / cr.width),
          scaleY: Math.max(0.02, br.height / cr.height),
        })
        return
      }
      if (tries++ < 20) raf = requestAnimationFrame(measure)
      else setMinimizeTarget({ x: 0, y: window.innerHeight / 2, scaleX: 0.06, scaleY: 0.02 })
    }
    raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [minimizing, minimizeTarget])

  function finishMinimize() {
    if (!minimizing) return
    setMinimized(true)
    setMinimizing(false)
    setMinimizeTarget(null)
    try {
      localStorage.setItem('agentsouk.quest.minimized', '1')
    } catch {}
    window.dispatchEvent(new CustomEvent('agentsouk.quest.visibility', { detail: { minimized: true } }))
  }

  function minimize() {
    if (reducedMotion) {
      setMinimized(true)
      try {
        localStorage.setItem('agentsouk.quest.minimized', '1')
      } catch {}
      window.dispatchEvent(new CustomEvent('agentsouk.quest.visibility', { detail: { minimized: true } }))
      return
    }
    // the bar draws the tab on this event; the effect above measures it
    try {
      localStorage.setItem('agentsouk.quest.minimized', '1')
    } catch {}
    window.dispatchEvent(new CustomEvent('agentsouk.quest.visibility', { detail: { minimized: true } }))
    setMinimizing(true)
  }

  const cardAnimate =
    minimizing && minimizeTarget
      ? {
          x: [0, minimizeTarget.x * 0.18, minimizeTarget.x * 0.55, minimizeTarget.x * 0.86, minimizeTarget.x],
          y: [0, minimizeTarget.y * 0.1, minimizeTarget.y * 0.42, minimizeTarget.y * 0.78, minimizeTarget.y],
          scaleX: [1, 1.01, 0.78, 0.42, minimizeTarget.scaleX],
          scaleY: [1, 1.04, 1.02, 0.62, minimizeTarget.scaleY],
          rotateX: [0, 6, 24, 52, 76],
          opacity: [1, 1, 1, 0.9, 0],
        }
      : { x: 0, y: 0, scaleX: 1, scaleY: 1, rotateX: 0, opacity: 1 }
  const cardTransition = minimizing
    ? {
        duration: 0.62,
        times: [0, 0.18, 0.48, 0.76, 1],
        ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
      }
    : { duration: 0.2 }

  // the whole quest is gated on this: without a wallet every step card would offer the same
  // connect prompt, so the wallet is taken once here rather than four times over there
  async function start() {
    setStarting(true)
    setError(null)
    try {
      if (wallet) writeQuestMode(wallet, 'active')
      navigate('/quest')
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setStarting(false)
    }
  }

  // looked up again on each page, since a wallet can be signed in anywhere on the site
  useEffect(() => {
    let live = true
    sessionAccount()
      .then((a) => {
        if (live) setWallet(a)
      })
      .catch(() => {})
      .finally(() => {
        if (live) setWalletKnown(true)
      })
    return () => {
      live = false
    }
  }, [pathname])

  useEffect(() => subscribeQuest(() => redraw((n) => n + 1)), [])

  // a minimized card hands off to the bottom bar; the bar can hand it back
  useEffect(() => {
    const onVis = (e: Event) => {
      const detail = (e as CustomEvent).detail as { minimized?: boolean } | undefined
      if (detail?.minimized === false) {
        setMinimized(false)
        try { localStorage.removeItem('agentsouk.quest.minimized') } catch {}
      }
    }
    window.addEventListener('agentsouk.quest.visibility', onVis)
    return () => window.removeEventListener('agentsouk.quest.visibility', onVis)
  }, [])

  // where the page's own first band ends: every screen opens its mono strap at a
  // different height. taken as a page coordinate, so a resize arriving while scrolled
  // measures the same thing an idle one does
  const [band, setBand] = useState(140)

  useEffect(() => {
    const measure = () => {
      const main = document.querySelector('main')
      if (!main) return
      const first = Array.from(main.querySelectorAll<HTMLElement>(':not(:has(*))')).find(
        (node) => (node.textContent ?? '').trim() !== '' && node.getBoundingClientRect().height > 0,
      )
      if (!first) return
      const bottom = first.getBoundingClientRect().bottom + window.scrollY
      setBand(Math.round(bottom + 14))
    }
    measure()
    window.addEventListener('resize', measure)
    // the strap is set in a webfont, so its box can move once the fonts land
    document.fonts.ready.then(measure).catch(() => {})
    return () => window.removeEventListener('resize', measure)
  }, [pathname])

  // read as it is drawn, so a wallet and its standing never disagree for a frame
  const mode = questModeFor(wallet)
  // the way back in belongs to the wallet that started; anyone else is still invited
  const started = wallet !== null && (mode === 'active' || mode === 'quit')
  const hidden = pathname.startsWith('/quest') || pathname.startsWith('/agents/')

  // a started quest shows how far it has got, read again as the visitor moves between pages,
  // at most every half minute, so a fresh hire shows without a reload
  useEffect(() => {
    if (!wallet || !started || hidden) return
    if (Date.now() - lastRead.current < REFRESH_MS) return
    lastRead.current = Date.now()
    getQuestProgress(wallet)
      .then(rememberQuestProgress)
      .catch(() => {})
  }, [wallet, started, hidden, pathname])

  if (hidden || !walletKnown) return null
  if (minimized) return null

  if (started) {
    // progress read for another wallet says nothing about this one
    const cached = latestQuestProgress()
    const progress = cached && wallet && cached.wallet.toLowerCase() === wallet.toLowerCase() ? cached : null
    if (progress?.completed) return null
    const done = requiredDone(progress)
    return (
      <aside
        aria-label="Set and Earn Quest"
        className={cx(INVITE, minimizing ? 'z-[60]' : 'z-40')}
        style={{ '--quest-top': `${band}px` } as CSSProperties}
      >
        <motion.div
          ref={cardRef}
          animate={cardAnimate}
          transition={cardTransition}
          onAnimationComplete={finishMinimize}
          style={{ transformOrigin: '50% 100%', transformPerspective: 800, transformStyle: 'preserve-3d' }}
        >
          <Stack
            hair
            radius={20}
            pad={[16, 22, 16, 22]}
            gap={8}
            className={cx(
              'relative bg-[linear-gradient(117deg,var(--mast-wash),var(--color-souk-surface1))]',
              !minimizing && 'backdrop-blur-md ring-1 ring-white/10 shadow-lg',
            )}
          >
          <button
            type="button"
            aria-label="Minimize quest card"
            onClick={minimize}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[4px] border border-souk-ink/30 text-[14px] font-bold leading-none text-souk-ink/60 transition hover:bg-souk-ink/10 hover:text-souk-ink"
          >
            -
          </button>
          <Label>Collect your Souk passport</Label>
          <Txt size={20} lead={26} weight="bold" tone="ink">
            Set and Earn
          </Txt>
          <Txt size={13} lead={20} tone="ink" className="opacity-75">
            Hire two agents and list one of your own, for BNB Chain's Set and Earn. Three stamps finish it, paid from your wallet.
          </Txt>
          <Row gap={8} className="mt-2">
            <Btn kind="primary" onClick={() => navigate('/quest')} className="grow basis-0">
              {done > 0 ? `Resume quest ${done}/3` : 'Resume quest'}
            </Btn>
          </Row>
        </Stack></motion.div>
      </aside>
    )
  }

  if (mode !== null) return null

  return (
    <aside
      aria-label="Set and Earn Quest"
      className={cx(INVITE, minimizing ? 'z-[60]' : 'z-40')}
      style={{ '--quest-top': `${band}px` } as CSSProperties}
    >
      <motion.div
        ref={cardRef}
        animate={cardAnimate}
        transition={cardTransition}
        onAnimationComplete={finishMinimize}
        style={{ transformOrigin: '50% 100%', transformPerspective: 800, transformStyle: 'preserve-3d' }}
      >
        <Stack
          hair
          radius={20}
          pad={[16, 22, 16, 22]}
          gap={8}
          className={cx(
            'relative bg-[linear-gradient(117deg,var(--mast-wash),var(--color-souk-surface1))]',
            !minimizing && 'backdrop-blur-md ring-1 ring-white/10 shadow-lg',
          )}
        >
        <button
          type="button"
          aria-label="Minimize quest card"
          onClick={minimize}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[4px] border border-souk-ink/30 text-[14px] font-bold leading-none text-souk-ink/60 transition hover:bg-souk-ink/10 hover:text-souk-ink"
        >
          -
        </button>
        <Label>Collect your Souk passport</Label>
        <Txt size={20} lead={26} weight="bold" tone="ink">
          Set and Earn
        </Txt>
        <Txt size={13} lead={20} tone="ink" className="opacity-75">
          Hire two agents and list one of your own, for BNB Chain's Set and Earn. Three stamps finish it, paid from your wallet.
        </Txt>
        <Row gap={8} className="mt-2">
          <Btn
            kind="primary"
            onClick={start}
            disabled={starting}
            className="grow basis-0"
          >
            {starting ? 'Waiting for your wallet' : 'Start Quest'}
          </Btn>
        </Row>
        {error && (
          <Txt size={13} lead={20} tone="peach">
            {error}
          </Txt>
        )}
      </Stack></motion.div>
    </aside>
  )
}
