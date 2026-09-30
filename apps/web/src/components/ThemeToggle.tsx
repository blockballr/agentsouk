import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ThemeChoice } from '../lib/theme'
import { getChoice, setChoice } from '../lib/theme'

// one tap moves to the next mode, so the control takes one square of the nav instead of three words
const ORDER: ThemeChoice[] = ['system', 'light', 'dark']
const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }

export function ThemeToggle() {
  const [choice, setLocal] = useState<ThemeChoice>(() => getChoice())
  const reducedMotion = useReducedMotion()
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]
  return (
    <button
      type="button"
      onClick={() => {
        setChoice(next)
        setLocal(next)
      }}
      aria-label={`Colour theme: ${LABEL[choice]}. Switch to ${LABEL[next]}`}
      title={`Theme: ${LABEL[choice]}. Tap for ${LABEL[next]}`}
      className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[4px] border hairline border-slate-verdant/40 text-newsprint-gray transition-colors hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={choice}
          aria-hidden="true"
          initial={reducedMotion ? false : { opacity: 0, rotate: -60, scale: 0.8 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, rotate: 60, scale: 0.8 }}
          transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="flex"
        >
          {choice === 'light' ? <SunGlyph /> : choice === 'dark' ? <MoonGlyph /> : <ScreenGlyph />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

function SunGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M3.05 12.95l1.13-1.13M11.82 4.18l1.13-1.13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MoonGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ScreenGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 14h5M8 11v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
