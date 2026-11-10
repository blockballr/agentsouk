import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

// the stylesheet sets scroll-behavior: smooth, which is right for an in-page
// anchor and wrong for a route change: a new page should open at its top, not
// drift there. Run the jump with smooth temporarily off.
function withoutSmooth(run: () => void) {
  const root = document.documentElement
  const previous = root.style.scrollBehavior
  root.style.scrollBehavior = 'auto'
  run()
  root.style.scrollBehavior = previous
}

export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const previousPath = useRef(pathname)
  useLayoutEffect(() => {
    // an anchor on the page the visitor is already reading is a section jump,
    // so it glides; an anchor that arrives with a new route still lands at once
    const samePage = previousPath.current === pathname
    previousPath.current = pathname
    if (hash) {
      const el = document.getElementById(hash.slice(1))
      if (el) {
        if (samePage) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        else withoutSmooth(() => el.scrollIntoView({ behavior: 'auto', block: 'start' }))
        return
      }
    }
    if (pathname === '/list') {
      const focusLookup = () => {
        const el = document.getElementById('endpoint-input') as HTMLInputElement | null
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' })
          el.focus()
          return true
        }
        return false
      }
      if (!focusLookup()) {
        const t = window.setTimeout(focusLookup, 120)
        const t2 = window.setTimeout(focusLookup, 400)
        return () => {
          window.clearTimeout(t)
          window.clearTimeout(t2)
        }
      }
      return
    }
    const doScroll = () => {
      withoutSmooth(() => {
        window.scrollTo(0, 0)
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
        const main = document.querySelector('main')
        if (main) (main as HTMLElement).scrollTop = 0
      })
    }
    doScroll()
    const t1 = window.setTimeout(doScroll, 0)
    const t2 = window.setTimeout(doScroll, 120)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [pathname, hash])
  return null
}
