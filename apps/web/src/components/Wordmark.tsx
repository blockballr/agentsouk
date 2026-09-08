import { Link } from 'react-router-dom'

// the designed logo, matching brand/og-repo.png exactly: the four-square
// souk mark (one tile in highlighter green) and the agent souk wordmark
// in fraunces 600 with the green swipe under the o of Souk
export function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className="inline-flex items-center gap-[11px] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 64 64">
        <rect x="8" y="8" width="22" height="22" rx="4" fill="currentColor" />
        <rect x="34" y="8" width="22" height="22" rx="4" fill="currentColor" />
        <rect x="8" y="34" width="22" height="22" rx="4" fill="currentColor" />
        <rect x="34" y="34" width="22" height="22" rx="4" fill="#2bee4b" />
      </svg>
      <span className="relative inline-block font-serif text-[27px] font-semibold leading-[0.9] tracking-[-0.04em] text-typesetter-ink">
        Agent S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.09em] left-[14%] h-[0.055em] w-[58%] bg-highlighter-green" /></span>uk
      </span>
    </Link>
  )
}
