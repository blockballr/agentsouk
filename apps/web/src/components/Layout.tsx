import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Nav } from './Nav'
import { NetworkTicker } from './NetworkTicker'
import { QuestNudge } from './QuestNudge'

// a route split is a short wait, not a blank page: the nav and the status bar
// stay put and only the body shows the fallback
function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <span className="micro text-souk-muted">loading</span>
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const isHome = location.pathname === '/'
  return (
    <div className={`min-h-screen bg-souk-canvas text-souk-ink ${isHome ? '' : 'pb-[52px]'}`}>
      <Nav />
      <main className="site-main">
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <QuestNudge />
      {/* persistent bottom status bar, fixed so it never scrolls away */}
      {!isHome && (
        <div className="fixed inset-x-0 bottom-0 z-50">
          <NetworkTicker />
        </div>
      )}
    </div>
  )
}