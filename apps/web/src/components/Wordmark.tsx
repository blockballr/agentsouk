import { Link } from 'react-router-dom'
import { SoukMark } from './souk'

// the designed logo, matching brand/og-repo.png exactly: the four-square
// souk mark (one tile in the redesign's data green) and the agent souk
// wordmark in fraunces 600 with the same green swiped under the o of Souk
const ON_APEX = window.location.hostname === 'agentsouk.xyz' || window.location.hostname === 'www.agentsouk.xyz'

export function Wordmark() {
  // the marketing homepage lives on the apex, so from the app, docs or station
  // the wordmark is a link back to that origin rather than to the SPA root
  const className =
    'inline-flex items-center gap-[11px] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black'
  if (!ON_APEX) {
    return (
      <a href="https://agentsouk.xyz/" aria-label="Agent Souk home" className={className}>
        <SoukMark size={22} />
        <span className="relative inline-block font-serif text-[27px] font-semibold leading-[0.9] tracking-[-0.04em] text-typesetter-ink">
          Agent S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.065em] left-[15%] h-[0.055em] w-[66%] bg-souk-data" /></span>uk
        </span>
      </a>
    )
  }
  return (
    <Link
      to="/"
      aria-label="Agent Souk home"
      className={className}
    >
      <SoukMark size={22} />
      <span className="relative inline-block font-serif text-[27px] font-semibold leading-[0.9] tracking-[-0.04em] text-typesetter-ink">
        Agent S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.065em] left-[15%] h-[0.055em] w-[66%] bg-souk-data" /></span>uk
      </span>
    </Link>
  )
}
