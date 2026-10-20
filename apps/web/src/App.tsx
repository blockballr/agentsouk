import { MotionConfig } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { MarketplacePage } from './pages/MarketplacePage'
import { AgentDetailPage } from './pages/AgentDetailPage'
import { ComparePage } from './pages/ComparePage'
import { AdvantagePage } from './pages/AdvantagePage'
import { ListAgentPage } from './pages/ListAgentPage'
import { BuildPage } from './pages/BuildPage'
import { CartPage } from './pages/CartPage'
import { OngoingPage } from './pages/OngoingPage'
import { ProfilePage } from './pages/ProfilePage'
import { StationPage } from './pages/StationPage'
import { QuestPage } from './pages/QuestPage'
import { SellerBoardPage } from './pages/SellerBoardPage'
import { SellerStallsPage } from './pages/SellerStallsPage'
import { MarketFacePage } from './pages/MarketFacePage'
import { StudioPage } from './pages/StudioPage'
import { DocsPage } from './pages/DocsPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkspaceShell } from './components/WorkspaceShell'
import VaultHirePage from './pages/VaultHirePage'

const ScoutPage = lazy(() => import('./pages/ScoutPage').then((m) => ({ default: m.ScoutPage })))

// the station's own address opens on the station rather than the market
const STATION_HOST = window.location.hostname === 'station.agentsouk.xyz'

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<Layout />}>
          {/* The homepage is the about page, and the marketplace lives at /agents.
              /about stays as an alias so the nav link and any shared URL keep working. */}
          <Route index element={STATION_HOST ? <StationPage /> : <HomePage />} />
          <Route path="/about" element={<HomePage />} />
          <Route path="/agents" element={<MarketplacePage />} />
          <Route path="/agents/:chainId/:tokenId" element={<AgentDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/advantage" element={<AdvantagePage />} />
          <Route path="/cart" element={<CartPage />} />
          {/* Everything a wallet manages sits inside one rail: profile, vault,
              ongoing, quest, studio and docs for now, plus the seller and
              station consoles. The marketplace and compare stay rail-free. */}
          <Route element={<WorkspaceShell />}>
            <Route path="/ongoing" element={<OngoingPage />} />
            <Route path="/quest" element={<QuestPage />} />
            <Route path="/vault" element={<VaultHirePage />} />
            <Route path="/vault/:chainId/:tokenId" element={<VaultHirePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/build" element={<BuildPage />} />
            <Route path="/list" element={<ListAgentPage />} />
            <Route path="/seller" element={<SellerBoardPage />} />
            <Route path="/seller/stalls" element={<SellerStallsPage />} />
            <Route path="/seller/face" element={<MarketFacePage />} />
            <Route
              path="/station"
              element={STATION_HOST ? <Navigate to="/" replace /> : <StationPage />}
            />
          </Route>
          {import.meta.env.DEV && (
            <Route
              path="/scout"
              element={
                <Suspense fallback={null}>
                  <ScoutPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<MarketplacePage />} />
        </Route>
      </Routes>
    </MotionConfig>
  )
}

export default App