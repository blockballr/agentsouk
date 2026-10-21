// Cloudflare Turnstile widget. Drop into any form to gate bot submissions.
// Set VITE_TURNSTILE_SITE_KEY in .env to enable; when unset, renders nothing
// (dev mode) so local development is not blocked.

import { useEffect, useRef } from 'react'

const SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ??
  // Cloudflare's documented always-passes test key, so the gate and the forms
  // can be exercised in local development without production credentials
  (import.meta.env.DEV ? '1x00000000000000000000AA' : undefined)

export const TURNSTILE_ENABLED = Boolean(SITE_KEY)

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          theme?: 'light' | 'dark' | 'auto'
          callback: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
        },
      ) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

export function Turnstile({
  onToken,
  theme = 'auto',
  className = 'mt-2',
}: {
  onToken: (token: string) => void
  theme?: 'light' | 'dark' | 'auto'
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return

    function render() {
      if (!window.turnstile || !ref.current) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY!,
        theme,
        callback: (token: string) => onToken(token),
        'error-callback': () => onToken(''),
        'expired-callback': () => onToken(''),
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
  }, [onToken, theme])

  if (!SITE_KEY) return null
  return <div ref={ref} className={className} />
}
