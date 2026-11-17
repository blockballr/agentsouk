// The seller console is one scrolled board, the way the design draws it: Board A
// is the morning view at the top, Board B the agents, Board C the market face.
// The section nav jumps between them without turning them into separate tools.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SellerBoardSection } from './SellerBoardSection'
import { SellerStallsSection } from './SellerStallsSection'
import { MarketFaceSection } from './MarketFaceSection'
import { SellerDataProvider } from '../lib/seller-data'
import { useConnectedAccount } from '../lib/use-connected-account'

const BOARDS = [
  { id: 'board', label: 'Earnings', note: 'today' },
  { id: 'agents', label: 'Agents', note: 'checks and actions' },
  { id: 'market-face', label: 'How buyers see you', note: 'shelf and hires' },
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
      <div className="flex gap-1 overflow-x-auto rounded-[8px] border border-souk-hair bg-souk-canvas/90 p-1 backdrop-blur">
        {BOARDS.map((board) => {
          const on = active === board.id
          return (
            <a
              key={board.id}
              href={`#${board.id}`}
              aria-current={on ? 'location' : undefined}
              className={`flex shrink-0 items-baseline gap-2 rounded-[8px] px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
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
      <div className="grid max-w-[1180px] gap-8 pb-24">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-data">Console</p>
          <h1 className="mt-1 text-[30px] font-bold leading-[36px] text-souk-ink">My agents</h1>
          <p className="mt-2 text-[15px] leading-[23px] text-souk-slate">How your agents are doing, what buyers paid, and how buyers see you.</p>
        </header>
        {/* before connecting there is nothing to read, so one card stands in for the three boards */}
        {account ? (
          <div>
            <BoardNav active={active} />
            <SellerBoardSection />
            <SellerStallsSection />
            <MarketFaceSection />
          </div>
        ) : (
          <section className="rounded-[16px] border border-souk-hair bg-souk-surface1/60 px-5 py-6">
            <h2 className="m-0 text-[18px] font-semibold text-souk-ink">Connect the wallet you list with.</h2>
            <p className="mt-2 max-w-[60ch] text-[14px] leading-[21px] text-souk-slate">
              Your agents, their checks, what buyers paid them and how they look on the shelf show here. Connect from the menu on the
              left, or the bar above on a narrow screen.
            </p>
            <Link to="/build" className="mt-4 inline-block text-[13px] text-souk-sky hover:underline">
              No agent yet? List one
            </Link>
          </section>
        )}
      </div>
    </SellerDataProvider>
  )
}
