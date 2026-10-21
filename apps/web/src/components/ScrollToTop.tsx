import { useLayoutEffect } from 'react'
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
  useLayoutEffect(() => {
    // an anchor is a destination inside the page: a seller link to /seller#stalls
    // must land on the stalls, not at the top of the board
    if (hash) {
      const el = document.getElementById(hash.slice(1))
      if (el) {
        withoutSmooth(() => el.scrollIntoView({ behavior: 'auto', block: 'start' }))
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
