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
    if (pathname === '/') return null
    if (pathname === '/docs' || pathname.startsWith('/docs/')) return `https://${DOCS_HOST}/${search}`
    if (pathname === '/station' || pathname.startsWith('/station/')) return `https://${STATION_HOST}/${search}`
    return `https://${APP_HOST}${pathname}${search}`
  }
  if (host === DOCS_HOST || host === STATION_HOST) {
    return pathname === '/' ? null : `https://${host}/${search}`
  }
  if (host === APP_HOST && pathname === '/') {
    return `https://${APP_HOST}/agents${search}`
  }
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
