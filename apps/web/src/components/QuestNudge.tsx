import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getQuestProgress,
  latestQuestProgress,
  questModeFor,
  rememberQuestProgress,
  stampsFrom,
  subscribeQuest,
  writeQuestMode,
} from '../lib/quest'
import { getActiveAccount } from '../lib/wallet'
import { Action, LABEL, card, cx } from './ui'

const REFRESH_MS = 30_000
// the way back into a started quest sits under the nav on every screen, in the primary
// colour, so it is the first thing seen and is small enough to cover nothing
const RESUME = 'fixed right-3 top-20 z-40 sm:right-6'
// the invitation floats over the page, so it carries its own background and shadow
// on a wide screen it sits under the nav too; narrower than that the same spot holds the
// page's own header, so it stays at the foot, and gives way to the compare bar there
const INVITE =
  'fixed bottom-3 left-3 right-3 z-40 bg-bone-white shadow-lg sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm xl:bottom-auto xl:top-20 [body:has([data-compare-bar])_&]:hidden xl:[body:has([data-compare-bar])_&]:block'

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

  // looked up again on each page, since a wallet can be connected anywhere on the site
  useEffect(() => {
    let live = true
    getActiveAccount()
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
    const stamps = stampsFrom(progress)
    const done = (['health', 'yield', 'stall', 'grid', 'rebalancing'] as const).filter((k) => stamps[k]).length
    return (
      <Action to="/quest" variant="primary" className={RESUME}>
        {done > 0 ? `Resume quest ${done}/5` : 'Resume quest'}
      </Action>
    )
  }

  if (mode !== null) return null

  return (
    <aside aria-label="Set and Earn quest" className={cx(card('strong', 'sm'), INVITE)}>
      <p className={LABEL}>Set and Earn quest</p>
      <h2 className="mt-2 font-serif text-[22px] leading-tight text-press-black">Collect your Souk passport</h2>
      <p className="mt-2 text-[13px] leading-5 text-newsprint-gray">
        Hire in four categories and list one agent of your own for BNB Chain&apos;s Set and Earn. Five stamps, with test
        tokens included.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Action
          variant="primary"
          onClick={() => {
            writeQuestMode(wallet, 'active')
            navigate('/quest')
          }}
          className="w-full"
        >
          Start quest
        </Action>
        <Action onClick={() => writeQuestMode(wallet, 'dismissed')} className="w-full">
          Not now
        </Action>
      </div>
    </aside>
  )
}
