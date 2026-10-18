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
import { connectWallet, sessionAccount } from '../lib/wallet-session'
import { hireErrorText } from '../lib/hire'
import { Action, cx } from './ui'
import { Btn, Label, Row, Stack, Txt } from './souk'

const REFRESH_MS = 30_000
// the way back into a started quest sits under the nav on every screen, in the primary
// colour, so it is the first thing seen and is small enough to cover nothing
const RESUME = 'fixed right-3 top-20 z-40 sm:right-6'
// the invitation floats over the page, carrying its own background. on a wide screen it
// hangs under the page's first band, measured below; narrower than that the page's own
// header owns the top, so it stays at the foot and gives way to the compare bar
const INVITE =
  'fixed bottom-3 left-3 right-3 z-40 rounded-[20px] shadow-lg sm:bottom-6 sm:left-auto sm:right-6 sm:w-[430px] xl:bottom-auto xl:top-[var(--quest-top)] [body:has([data-compare-bar])_&]:hidden xl:[body:has([data-compare-bar])_&]:block'

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

  // the whole quest is gated on this: without a wallet every step card would offer the same
  // connect prompt, so the wallet is taken once here rather than four times over there
  async function start() {
    setStarting(true)
    setError(null)
    try {
      const who = wallet ?? (await connectWallet())
      writeQuestMode(who, 'active')
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

  if (started) {
    // progress read for another wallet says nothing about this one
    const cached = latestQuestProgress()
    const progress = cached && wallet && cached.wallet.toLowerCase() === wallet.toLowerCase() ? cached : null
    if (progress?.completed) return null
    const done = requiredDone(progress)
    return (
      <Action to="/quest" variant="primary" className={RESUME}>
        {done > 0 ? `Resume quest ${done}/3` : 'Resume quest'}
      </Action>
    )
  }

  if (mode !== null) return null

  return (
    <aside
      aria-label="Set and Earn quest"
      className={cx(INVITE)}
      style={{ '--quest-top': `${band}px` } as CSSProperties}
    >
      <Stack bg="indigo" hair radius={20} pad={[16, 22, 16, 22]} gap={8}>
        <Label>Set and Earn quest</Label>
        <Txt size={20} lead={26} weight="bold" tone="white">
          Set and Earn
        </Txt>
        {/* white, because the paper register turns the slate to navy and this stays indigo */}
        <Txt size={13} lead={20} tone="white" className="opacity-75">
          Collect your Souk passport
        </Txt>
        <Row gap={8} className="mt-2">
          <Btn
            kind="primary"
            onClick={start}
            disabled={starting}
            className="grow basis-0"
          >
            {starting ? 'Waiting for your wallet' : 'Start quest'}
          </Btn>
          <Btn kind="off" onClick={() => writeQuestMode(wallet, 'dismissed')} className="grow basis-0">
            Not now
          </Btn>
        </Row>
        {error && (
          <Txt size={13} lead={20} tone="peach">
            {error}
          </Txt>
        )}
      </Stack>
    </aside>
  )
}
