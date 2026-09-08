import { useState } from 'react'
import type { ThemeChoice } from '../lib/theme'
import { getChoice, setChoice } from '../lib/theme'

const options: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeToggle() {
  const [choice, setLocal] = useState<ThemeChoice>(() => getChoice())
  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex rounded-[4px] border hairline border-slate-verdant/40"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={choice === o.value}
          onClick={() => {
            setChoice(o.value)
            setLocal(o.value)
          }}
          className={`micro px-2.5 py-1.5 transition-colors first:rounded-l-[3px] last:rounded-r-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
            choice === o.value
              ? 'bg-press-black text-bone-white'
              : 'text-newsprint-gray hover:text-press-black'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
