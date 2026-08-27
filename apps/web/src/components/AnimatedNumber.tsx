import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { EASE_OUT_EXPO } from '../lib/motion'

// counts up to value once on mount
// reduced motion jumps straight to the final value
export function AnimatedNumber({
  value,
  delay = 0,
  duration = 1.2,
}: {
  value: number
  delay?: number
  duration?: number
}) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    let controls: ReturnType<typeof animate> | undefined
    const timer = setTimeout(() => {
      controls = animate(0, value, {
        duration,
        ease: EASE_OUT_EXPO,
        onUpdate: (v) => setDisplay(Math.round(v)),
      })
    }, delay)
    return () => {
      clearTimeout(timer)
      controls?.stop()
    }
  }, [value, delay, duration, reduced])

  return <>{display.toLocaleString('en-US')}</>
}