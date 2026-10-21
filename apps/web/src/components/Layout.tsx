import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'
import { NetworkTicker } from './NetworkTicker'
import { QuestNudge } from './QuestNudge'

export function Layout() {
  return (
    <div className="min-h-screen bg-souk-canvas text-souk-ink pb-[52px]">
      <Nav />
      <main>
        <Outlet />
      </main>
      <QuestNudge />
      {/* persistent bottom status bar, fixed so it never scrolls away */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <NetworkTicker />
      </div>
    </div>
  )
}