import { Link } from 'react-router-dom'

// the designed lockup, matching brand/lockup-preview.html exactly:
// arch mark, Souk in fraunces 600 with the green swipe under the o,
// and the market tagline in micro caps
export function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className="inline-flex items-baseline gap-[10px] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <svg aria-hidden="true" width="19" height="19" viewBox="0 0 64 64" className="self-center">
        <path d="M15 58 V34 Q15 16 32 8 Q49 16 49 34 V58" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="square" />
        <circle cx="32" cy="38" r="6.5" fill="#2bee4b" />
      </svg>
      <span className="relative inline-block font-serif text-[22px] font-semibold leading-[0.9] tracking-[-0.04em] text-typesetter-ink">
        S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.09em] left-[14%] h-[0.055em] w-[58%] bg-highlighter-green" /></span>uk
      </span>
      <span className="hidden text-[11px] font-medium uppercase tracking-[0.06em] text-[#516254] md:inline">
        The agent market on BNB
      </span>
    </Link>
  )
}
