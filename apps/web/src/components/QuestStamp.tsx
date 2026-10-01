import { useId } from 'react'
import type { StepKey } from '../lib/quest'
import { cx } from './ui'

// the same stamps the share card carries, so a quester sees on each step the mark it leaves
const VISA: Record<Exclude<StepKey, 'seal'>, { label: string; note: string; tilt: number }> = {
  first: { label: 'FIRST HIRE', note: 'HIRED', tilt: -5 },
  stall: { label: 'OWN STALL', note: 'LISTED', tilt: -4 },
  second: { label: 'SECOND HIRE', note: 'HIRED', tilt: 4 },
  third: { label: 'THIRD HIRE', note: 'HIRED', tilt: -3 },
}

// a faint outline of where the stamp goes until the step is finished, then the stamp in ink.
// Its lines are broken in both states, the outer one most, as they are on the card.
// Decoration only: the step's state is always said in words beside it
export function QuestStamp({
  step,
  stamped,
  press,
  className,
}: {
  step: StepKey
  stamped: boolean
  // the stamp has only just been earned, so it comes down on the page
  press?: boolean
  className?: string
}) {
  const ring = useId()
  const ink = cx(stamped ? 'text-green-ink opacity-90' : 'text-newsprint-gray opacity-40', stamped && press && 'stamp-press', className)

  if (step === 'seal') {
    return (
      <svg viewBox="0 0 120 120" aria-hidden="true" className={ink}>
        <g transform="rotate(-11 60 60)" fill="none" stroke="currentColor">
          <circle cx="60" cy="60" r="54" strokeWidth="3" strokeDasharray="6 4" />
          <circle cx="60" cy="60" r="48" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx="60" cy="60" r="30" strokeWidth="1" />
          <path id={ring} d="M60 21a39 39 0 1 1 0 78 39 39 0 1 1 0-78" stroke="none" />
          <text fill="currentColor" stroke="none" fontSize="8.4" fontWeight="700" textLength="238" lengthAdjust="spacing">
            <textPath href={`#${ring}`}>SET AND EARN * AGENT SOUK * BNB CHAIN *</textPath>
          </text>
          <text x="60" y="58" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9.5" fontWeight="800" letterSpacing="0.9">
            COMPLETE
          </text>
          <path d="M40 63h40" strokeWidth="1" />
          <text x="60" y="75" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7.5" fontWeight="600" letterSpacing="1">
            PASSPORT
          </text>
        </g>
      </svg>
    )
  }

  const { label, note, tilt } = VISA[step]
  return (
    <svg viewBox="0 0 176 92" aria-hidden="true" className={ink}>
      <g transform={`rotate(${tilt} 88 46)`} fill="none" stroke="currentColor">
        <rect x="10" y="12" width="156" height="68" rx="8" strokeWidth="3" strokeDasharray="6 4" />
        <rect x="16" y="18" width="144" height="56" rx="5" strokeWidth="1" strokeDasharray="2 2" />
        <text x="88" y="45" textAnchor="middle" fill="currentColor" stroke="none" fontSize="14" fontWeight="700" letterSpacing="1.2">
          {label}
        </text>
        <text x="88" y="63" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11" fontWeight="600" letterSpacing="2.4">
          {note}
        </text>
      </g>
    </svg>
  )
}
