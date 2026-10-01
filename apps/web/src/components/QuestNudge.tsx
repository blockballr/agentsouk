import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  getQuestProgress,
  latestQuestProgress,
  readQuestMode,
  rememberQuestProgress,
  stampsFrom,
  subscribeQuest,
  writeQuestMode,
} from '../lib/quest'
import { getActiveAccount } from '../lib/wallet'
import { Action, LABEL, card, cx } from './ui'

const REFRESH_MS = 30_000
// it floats over the page, so it carries its own background and shadow; the compare bar
// floats in the same place, so the corner gives way while that is showing
const CORNER =
  'fixed bottom-3 right-3 z-40 bg-bone-white shadow-lg sm:bottom-6 sm:right-6 [body:has([data-compare-bar])_&]:hidden'

// the quest's one spot at the corner of the page: an invitation before it is started, then a
// way back in until it is finished. Never a blocking modal, and kept off agent pages, whose
// phone hire bar owns the bottom of the screen
export function QuestNudge() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [wallet, setWallet] = useState<string | null>(null)
  const [mode, setMode] = useState(() => readQuestMode(null))
  const [, redraw] = useState(0)
  const lastRead = useRef(0)

  useEffect(() => {
    let live = true
    getActiveAccount()
      .then((a) => {
        if (live && a) setWallet(a)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setMode(readQuestMode(wallet) ?? readQuestMode(null))
      redraw((n) => n + 1)
    }
    sync()
    return subscribeQuest(sync)
  }, [wallet])

  const started = mode === 'active' || mode === 'quit'
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

  if (hidden) return null

  if (started) {
    // progress read for another wallet says nothing about this one
    const cached = latestQuestProgress()
    const progress = cached && wallet && cached.wallet.toLowerCase() === wallet.toLowerCase() ? cached : null
    if (progress?.completed) return null
    const stamps = stampsFrom(progress)
    const done = (['health', 'yield', 'stall', 'grid', 'rebalancing'] as const).filter((k) => stamps[k]).length
    return (
      <Action to="/quest" className={CORNER}>
        {done > 0 ? `Resume quest ${done}/5` : 'Resume quest'}
      </Action>
    )
  }

  if (mode !== null) return null

  return (
    <aside aria-label="Set and Earn quest" className={cx(card('strong', 'sm'), CORNER, 'left-3 sm:left-auto sm:max-w-sm')}>
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
