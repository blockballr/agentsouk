import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// On every route change, open the new page from the top instead of carrying
// over the previous page's scroll position. The /list page is the exception:
// it scrolls to and focuses the lookup input so the user can paste an endpoint.
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (pathname === '/list') {
      const focusLookup = () => {
        const el = document.getElementById('token-lookup') as HTMLInputElement | null
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])
  return null
}
