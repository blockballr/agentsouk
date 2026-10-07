import { MotionConfig } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { MarketplacePage } from './pages/MarketplacePage'
import { AgentDetailPage } from './pages/AgentDetailPage'
import { ComparePage } from './pages/ComparePage'
import { AdvantagePage } from './pages/AdvantagePage'
import { ListAgentPage } from './pages/ListAgentPage'
import { CartPage } from './pages/CartPage'
import { OngoingPage } from './pages/OngoingPage'
import { ProfilePage } from './pages/ProfilePage'
import { QuestPage } from './pages/QuestPage'
import VaultHirePage from './pages/VaultHirePage'

const ScoutPage = lazy(() => import('./pages/ScoutPage').then((m) => ({ default: m.ScoutPage })))

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<Layout />}>
          {/* The homepage is the about page, and the marketplace lives at /agents.
              /about stays as an alias so the nav link and any shared URL keep working. */}
          <Route index element={<HomePage />} />
          <Route path="/about" element={<HomePage />} />
          <Route path="/agents" element={<MarketplacePage />} />
          <Route path="/agents/:chainId/:tokenId" element={<AgentDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/advantage" element={<AdvantagePage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/ongoing" element={<OngoingPage />} />
          <Route path="/vault" element={<VaultHirePage />} />
          <Route path="/vault/:chainId/:tokenId" element={<VaultHirePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/quest" element={<QuestPage />} />
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
          <Route path="/list" element={<ListAgentPage />} />
          <Route path="*" element={<MarketplacePage />} />
        </Route>
      </Routes>
    </MotionConfig>
  )
}

export default App