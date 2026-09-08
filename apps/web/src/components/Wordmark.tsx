import { Link } from 'react-router-dom'

export function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className="relative inline-block text-[15px] font-bold tracking-[-0.02em] text-typesetter-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      AGENT SOUK
      <span
        aria-hidden="true"
        className="absolute top-full left-[34px] h-[2px] w-10 bg-highlighter-green"
      />
    </Link>
  )
}