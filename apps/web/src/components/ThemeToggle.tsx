import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { ThemeChoice } from '../lib/theme'
import { getChoice, setChoice } from '../lib/theme'

const options: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeToggle() {
  const [choice, setLocal] = useState<ThemeChoice>(() => getChoice())
  const reducedMotion = useReducedMotion()
  const activeIndex = options.findIndex((o) => o.value === choice)
  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="relative flex rounded-[4px] border hairline border-slate-verdant/40"
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        className="absolute inset-y-0 left-0 w-1/3 rounded-[3px] bg-press-black"
        animate={{ x: `${activeIndex * 100}%`, opacity: 1 }}
        transition={
          reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }
        }
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={choice === o.value}
          onClick={() => {
            setChoice(o.value)
            setLocal(o.value)
          }}
          className={`relative z-10 flex-1 px-2.5 py-1.5 transition-colors first:rounded-l-[3px] last:rounded-r-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
            choice === o.value
              ? 'text-bone-white'
              : 'text-newsprint-gray hover:text-press-black'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
