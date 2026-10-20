import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

export function ScrollToTop() {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    if (pathname === '/list') {
      const focusLookup = () => {
        const el = document.getElementById('token-lookup') as HTMLInputElement | null
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' })
          el.focus()
          return true
        }
        return false
      }
      if (!focusLookup()) {
        const t = window.setTimeout(focusLookup, 120)
        return () => window.clearTimeout(t)
      }
      return
    }
    const doScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      const main = document.querySelector('main')
      if (main) (main as HTMLElement).scrollTop = 0
    }
    doScroll()
    const t1 = window.setTimeout(doScroll, 0)
    const t2 = window.setTimeout(doScroll, 120)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [pathname])
  return null
}
