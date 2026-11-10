// An in-page section jump with a gentle ease. The browser's native smooth scroll
// is short and starts abruptly; this runs a little longer and eases at both ends,
// which is what makes a nav click feel like the page moved rather than snapped.
// The offset clears the fixed-ish bar so the heading is not tucked under it.

const OFFSET = 88
const DURATION = 800

export function scrollToSection(target: string | HTMLElement): void {
  const el = typeof target === 'string' ? document.getElementById(target) : target
  if (!el) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollIntoView({ behavior: 'instant', block: 'start' })
    return
  }
  // the stylesheet makes every scroll smooth, which would animate each frame of
  // this loop separately; each frame is an instant step of the overall ease
  const root = document.documentElement
  const previous = root.style.scrollBehavior
  root.style.scrollBehavior = 'auto'
  const startY = window.scrollY
  const targetY = Math.max(0, el.getBoundingClientRect().top + startY - OFFSET)
  const distance = targetY - startY
  if (Math.abs(distance) < 2) {
    root.style.scrollBehavior = previous
    return
  }
  // start the clock on the first painted frame, not at the call: a busy main
  // thread can delay that frame, and measuring from the call would then skip
  // straight to the end of the ease
  let started: number | null = null
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
  const step = (now: number) => {
    if (started === null) started = now
    const progress = Math.min(1, (now - started) / DURATION)
    window.scrollTo({ top: Math.round(startY + distance * ease(progress)), behavior: 'instant' })
    if (progress < 1) requestAnimationFrame(step)
    else root.style.scrollBehavior = previous
  }
  requestAnimationFrame(step)
}
