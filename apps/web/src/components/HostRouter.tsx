import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// The Pages Function redirects a full page load, but the app is a single page:
// a link clicked on the homepage never reaches the server. This guard applies
// the same host rules inside the SPA, so the marketing homepage cannot quietly
// become the marketplace and the app root cannot render the marketing page.
const APEX_HOSTS = new Set(['agentsouk.xyz', 'www.agentsouk.xyz'])
const APP_HOST = 'app.agentsouk.xyz'
const DOCS_HOST = 'docs.agentsouk.xyz'
const STATION_HOST = 'station.agentsouk.xyz'

function destination(host: string, pathname: string, search: string): string | null {
  if (APEX_HOSTS.has(host)) {
    if (pathname === '/' || pathname === '/about') return null
    if (pathname === '/docs' || pathname.startsWith('/docs/')) {
      const rest = pathname.replace(/^\/docs/, '') || '/'
      return `https://${DOCS_HOST}${rest}${search}`
    }
    if (pathname === '/station' || pathname.startsWith('/station/')) {
      const rest = pathname.replace(/^\/station/, '') || '/'
      return `https://${STATION_HOST}${rest}${search}`
    }
    return `https://${APP_HOST}${pathname}${search}`
  }
  // App, docs and station keep their own addresses. The app root is redirected
  // by the router, and the docs/station wildcards fall back to their own home,
  // so no same-host navigation needs a full page reload.
  return null
}

export function HostRouter({ children }: { children: React.ReactNode }) {
  const { pathname, search } = useLocation()
  const to = typeof window === 'undefined' ? null : destination(window.location.hostname, pathname, search)

  useEffect(() => {
    if (to) window.location.replace(to)
  }, [to])

  if (!to) return <>{children}</>
  return (
    <div className="flex min-h-screen items-center justify-center bg-souk-canvas px-6 text-center">
      <p className="text-[12px] uppercase tracking-[0.12em] text-souk-steel">Taking you to {new URL(to).host}</p>
    </div>
  )
}
