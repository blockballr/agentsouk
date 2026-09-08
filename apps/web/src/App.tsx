import { MotionConfig } from 'framer-motion'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { MarketplacePage } from './pages/MarketplacePage'
import { AgentDetailPage } from './pages/AgentDetailPage'
import { ComparePage } from './pages/ComparePage'
import { AdvantagePage } from './pages/AdvantagePage'
import { ListAgentPage } from './pages/ListAgentPage'

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/agents" element={<MarketplacePage />} />
          <Route path="/agents/:chainId/:tokenId" element={<AgentDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/advantage" element={<AdvantagePage />} />
          <Route path="/list" element={<ListAgentPage />} />
          <Route path="*" element={<HomePage />} />
        </Route>
      </Routes>
    </MotionConfig>
  )
}

export default App