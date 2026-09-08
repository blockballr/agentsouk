import { Link } from 'react-router-dom'

// the four-tile souk mark, one tile in highlighter green
function SoukMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 64 64" className="inline-block align-[-2px]">
      <rect x="8" y="8" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="34" y="8" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="8" y="34" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="34" y="34" width="22" height="22" rx="4" fill="#2bee4b" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className="relative inline-flex items-center gap-[6px] text-[15px] font-bold tracking-[-0.02em] text-typesetter-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <SoukMark />
      AGENT SOUK
      <span
        aria-hidden="true"
        className="absolute top-full left-[24px] h-[2px] w-10 bg-highlighter-green"
      />
    </Link>
  )
}
