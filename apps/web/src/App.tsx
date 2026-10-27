import { MotionConfig } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { ScrollToTop } from './components/ScrollToTop'
import { SecurityGate } from './components/SecurityGate'
import { HostRouter } from './components/HostRouter'
import { WorkspaceShell } from './components/WorkspaceShell'

// every surface except the landing page is split out: the shelf and the agent
// detail are the pages a visitor waits on, so they must not carry the builder,
// the consoles and the settings screens in the same first chunk
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage })))
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage').then((m) => ({ default: m.AgentDetailPage })))
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })))
const AdvantagePage = lazy(() => import('./pages/AdvantagePage').then((m) => ({ default: m.AdvantagePage })))
const ListAgentPage = lazy(() => import('./pages/ListAgentPage').then((m) => ({ default: m.ListAgentPage })))
const BuildPage = lazy(() => import('./pages/BuildPage').then((m) => ({ default: m.BuildPage })))
const ManifestBuilderPage = lazy(() => import('./pages/ManifestBuilderPage').then((m) => ({ default: m.ManifestBuilderPage })))
const CustomBuilderPage = lazy(() => import('./pages/CustomBuilderPage').then((m) => ({ default: m.CustomBuilderPage })))
const OngoingPage = lazy(() => import('./pages/OngoingPage').then((m) => ({ default: m.OngoingPage })))
const StationPage = lazy(() => import('./pages/StationPage').then((m) => ({ default: m.StationPage })))
const QuestPage = lazy(() => import('./pages/QuestPage').then((m) => ({ default: m.QuestPage })))
const SellerConsolePage = lazy(() => import('./pages/SellerConsolePage').then((m) => ({ default: m.SellerConsolePage })))
const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })))
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })))
const DocsTocPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsTocPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const SettingsProfilePage = lazy(() => import('./pages/SettingsProfilePage').then((m) => ({ default: m.SettingsProfilePage })))
const SettingsSecurityPage = lazy(() => import('./pages/SettingsSecurityPage').then((m) => ({ default: m.SettingsSecurityPage })))
const ManageAccountPage = lazy(() => import('./pages/ManageAccountPage').then((m) => ({ default: m.ManageAccountPage })))
const VaultHirePage = lazy(() => import('./pages/VaultHirePage'))
const DesignPnlPage = lazy(() => import('./pages/DesignPnlPage').then((m) => ({ default: m.DesignPnlPage })))
const ScoutPage = lazy(() => import('./pages/ScoutPage').then((m) => ({ default: m.ScoutPage })))

// each surface has its own address; there it opens on its own page rather than
// the market. The apex keeps only the homepage.
const STATION_HOST = window.location.hostname === 'station.agentsouk.xyz'
const DOCS_HOST = window.location.hostname === 'docs.agentsouk.xyz'
const APP_HOST = window.location.hostname === 'app.agentsouk.xyz'

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ScrollToTop />
      <HostRouter>
      <SecurityGate>
        <Routes>
          <Route element={<Layout />}>
            {/* The homepage is the about page, and the marketplace lives at /agents.
                /about stays as an alias so the nav link and any shared URL keep working. */}
            <Route
              index
              element={
                STATION_HOST ? <StationPage /> : DOCS_HOST ? <DocsPage /> : APP_HOST ? <Navigate to="/agents" replace /> : <HomePage />
              }
            />
            <Route path="/about" element={<HomePage />} />
            <Route path="/agents" element={<MarketplacePage />} />
            <Route path="/agents/:chainId/:tokenId" element={<AgentDetailPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/advantage" element={<AdvantagePage />} />
            {/* Everything a wallet manages sits inside one rail: profile, vault,
                ongoing, quest, studio and docs for now, plus the seller and
                station consoles. The marketplace and compare stay rail-free. */}
            <Route element={<WorkspaceShell />}>
              <Route path="/ongoing" element={<OngoingPage />} />
              <Route path="/quest" element={<QuestPage />} />
              <Route path="/vault" element={<VaultHirePage />} />
              <Route path="/vault/:chainId/:tokenId" element={<VaultHirePage />} />
              <Route path="/profile" element={<Navigate to="/seller" replace />} />
              <Route path="/studio" element={<StudioPage />} />
              <Route path="/docs" element={DOCS_HOST ? <Navigate to="/" replace /> : <DocsTocPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/profile" element={<SettingsProfilePage />} />
              <Route path="/settings/security" element={<SettingsSecurityPage />} />
              <Route path="/account" element={<ManageAccountPage />} />
              <Route path="/build" element={<CustomBuilderPage />} />
              <Route path="/build/manifest" element={<ManifestBuilderPage />} />
            <Route path="/build/strategy" element={<BuildPage />} />
              <Route path="/list" element={<ListAgentPage />} />
              <Route path="/seller" element={<SellerConsolePage />} />
              <Route path="/seller/stalls" element={<Navigate to="/seller#agents" replace />} />
              <Route path="/seller/face" element={<Navigate to="/seller#market-face" replace />} />
              <Route
                path="/station"
                element={STATION_HOST ? <Navigate to="/" replace /> : <StationPage />}
              />
            </Route>
            {import.meta.env.DEV && (
              <>
                <Route
                  path="/scout"
                  element={
                    <Suspense fallback={null}>
                      <ScoutPage />
                    </Suspense>
                  }
                />
                <Route path="/design/pnl" element={<DesignPnlPage />} />
              </>
            )}
            <Route path="*" element={STATION_HOST || DOCS_HOST ? <Navigate to="/" replace /> : <MarketplacePage />} />
          </Route>
        </Routes>
      </SecurityGate>
      </HostRouter>
    </MotionConfig>
  )
}

export default App