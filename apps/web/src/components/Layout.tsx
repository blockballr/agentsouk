import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'
import { QuestNudge } from './QuestNudge'

export function Layout() {
  return (
    <div className="min-h-screen bg-bone-white text-typesetter-ink">
      <Nav />
      <main>
        <Outlet />
      </main>
      <QuestNudge />
    </div>
  )
}