import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readQuestMode, subscribeQuest, writeQuestMode } from '../lib/quest'
import { getActiveAccount } from '../lib/wallet'

// offered once per browser and wallet: a card at the corner, a sheet on a phone, never a blocking modal;
// kept off agent pages, whose phone hire bar owns the bottom of the screen
export function QuestNudge() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [wallet, setWallet] = useState<string | null>(null)
  const [mode, setMode] = useState(() => readQuestMode(null))

  useEffect(() => {
    let live = true
    getActiveAccount()
      .then((a) => {
        if (!live || !a) return
        setWallet(a)
        setMode(readQuestMode(a) ?? readQuestMode(null))
      })
      .catch(() => {})
    const off = subscribeQuest(() => setMode(readQuestMode(wallet) ?? readQuestMode(null)))
    return () => {
      live = false
      off()
    }
  }, [wallet])

  if (mode !== null || pathname.startsWith('/quest') || pathname.startsWith('/agents/')) return null

  return (
    <aside
      aria-label="Set and Earn quest"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-press-black bg-bone-white p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm sm:rounded-[14px] sm:border"
    >
      <h2 className="font-serif text-2xl font-medium leading-tight tracking-[-0.02em]">Collect your Souk passport</h2>
      <p className="mt-2 text-sm leading-relaxed text-newsprint-gray">
        Hire in four categories and open a stall of your own for BNB Chain&apos;s Set and Earn. Five stamps, test tokens
        included, and every step is one tap.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            writeQuestMode(wallet, 'active')
            navigate('/quest')
          }}
          className="micro inline-flex min-h-11 items-center rounded-[5px] bg-highlighter-green px-5 text-on-highlighter transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Start the quest
        </button>
        <button
          type="button"
          onClick={() => writeQuestMode(wallet, 'dismissed')}
          className="micro inline-flex min-h-11 items-center px-3 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Not now
        </button>
      </div>
    </aside>
  )
}
