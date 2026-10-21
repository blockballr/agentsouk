// Cloudflare Turnstile widget. Drop into any form to gate bot submissions.
// Set VITE_TURNSTILE_SITE_KEY in .env to enable; when unset, renders nothing
// (dev mode) so local development is not blocked.

import { useEffect, useRef } from 'react'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'error-callback'?: () => void }) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return

    function render() {
      if (!window.turnstile || !ref.current) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY!,
        callback: (token: string) => onToken(token),
        'error-callback': () => onToken(''),
      })
    }

    if (!document.querySelector('script[src*="turnstile"]')) {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.defer = true
      s.onload = render
      document.head.appendChild(s)
    } else {
      render()
    }

    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [onToken])

  if (!SITE_KEY) return null
  return <div ref={ref} className="mt-2" />
}
