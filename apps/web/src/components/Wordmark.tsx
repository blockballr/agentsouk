import { Link } from 'react-router-dom'
import { SoukMark } from './souk'

// the designed logo, matching brand/og-repo.png exactly: the four-square
// souk mark (one tile in the redesign's data green) and the agent souk
// wordmark in fraunces 600 with the same green swiped under the o of Souk
export function Wordmark() {
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className="inline-flex items-center gap-[11px] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <SoukMark size={22} />
      <span className="relative inline-block font-serif text-[27px] font-semibold leading-[0.9] tracking-[-0.04em] text-typesetter-ink">
        Agent S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.09em] left-[14%] h-[0.055em] w-[58%] bg-souk-data" /></span>uk
      </span>
    </Link>
  )
}
