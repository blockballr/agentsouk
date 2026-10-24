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

let loader: Promise<void> | null = null

// The script is loaded once for the whole app. A repeat caller waits on the same
// promise instead of appending a second copy or rendering into an empty box.
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (loader) return loader

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]',
    )

    const waitForApi = () => {
      if (window.turnstile) {
        resolve()
        return
      }
      const started = Date.now()
      const timer = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(timer)
          resolve()
        } else if (Date.now() - started > 10_000) {
          window.clearInterval(timer)
          reject(new Error('Turnstile did not load'))
        }
      }, 100)
    }

    if (existing) {
      existing.addEventListener('load', waitForApi, { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile did not load')), {
        once: true,
      })
      // the script may already have fired load before this effect ran
      waitForApi()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = waitForApi
    script.onerror = () => reject(new Error('Turnstile did not load'))
    document.head.appendChild(script)
  })

  return loader
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
    let cancelled = false

    const mount = async () => {
      try {
        await loadTurnstile()
      } catch {
        return
      }
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY!,
        theme,
        callback: (token: string) => onToken(token),
        'error-callback': () => onToken(''),
        'expired-callback': () => onToken(''),
      })
    }

    void mount()

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [onToken, theme])

  if (!SITE_KEY) return null
  return <div ref={ref} className={className} />
}
