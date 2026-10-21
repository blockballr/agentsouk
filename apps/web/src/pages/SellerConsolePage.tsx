// The seller console is one scrolled board, the way the design draws it: Board A
// is the morning view at the top, Board B the stalls, Board C the market face.
// The section nav jumps between them without turning them into separate tools.
import { useEffect, useState } from 'react'
import { SellerBoardSection } from './SellerBoardSection'
import { SellerStallsSection } from './SellerStallsSection'
import { MarketFaceSection } from './MarketFaceSection'
import { SellerDataProvider } from '../lib/seller-data'
import { useConnectedAccount } from '../lib/use-connected-account'

const BOARDS = [
  { id: 'board', label: 'Board', note: 'today' },
  { id: 'stalls', label: 'Stalls', note: 'listings' },
  { id: 'market-face', label: 'Market face', note: 'money and people' },
] as const

// the last board whose top has passed the sticky nav is the one in view; the
// scroll listener is cheaper to reason about here than an observer on very tall
// sections that all overlap the viewport
function useActiveBoard(): string {
  const [active, setActive] = useState<string>(BOARDS[0].id)
  useEffect(() => {
    let frame = 0
    const read = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        // the last board is short enough that the page cannot scroll its top to
        // the nav; at the bottom of the page the bottom board is the one in view
        const root = document.documentElement
        const atBottom =
          root.scrollHeight > window.innerHeight + 8 &&
          window.innerHeight + window.scrollY >= root.scrollHeight - 4
        let current: string = BOARDS[0].id
        if (atBottom) current = BOARDS[BOARDS.length - 1].id
        else {
          for (const board of BOARDS) {
            const el = document.getElementById(board.id)
            if (el && el.getBoundingClientRect().top <= 140) current = board.id
          }
        }
        setActive(current)
      })
    }
    read()
    window.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      window.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])
  return active
}

function BoardNav({ active }: { active: string }) {
  return (
    <nav aria-label="Seller boards" className="sticky top-3 z-20 mb-8 w-fit max-w-full">
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-souk-hair bg-souk-canvas/90 p-1 backdrop-blur">
        {BOARDS.map((board) => {
          const on = active === board.id
          return (
            <a
              key={board.id}
              href={`#${board.id}`}
              aria-current={on ? 'location' : undefined}
              className={`flex shrink-0 items-baseline gap-2 rounded-xl px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
                on
                  ? 'bg-souk-surface2 text-souk-ink'
                  : 'text-souk-steel hover:text-souk-ink'
              }`}
            >
              <span className="font-mono text-[10px] font-bold uppercase leading-[14px]">
                {board.label}
              </span>
              <span className={`text-[10px] leading-[14px] ${on ? 'text-souk-muted' : 'text-souk-muted/80'}`}>
                {board.note}
              </span>
            </a>
          )
        })}
      </div>
    </nav>
  )
}

export function SellerConsolePage() {
  // one wallet read for all three boards; a switch re-reads the console
  const account = useConnectedAccount()
  const active = useActiveBoard()
  return (
    <SellerDataProvider account={account}>
      <div className="pb-24">
        <BoardNav active={active} />
        <SellerBoardSection />
        <SellerStallsSection />
        <MarketFaceSection />
      </div>
    </SellerDataProvider>
  )
}
