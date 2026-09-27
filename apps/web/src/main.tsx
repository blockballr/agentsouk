import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
import './theme.css'
import App from './App'
import { watchStaleChunks } from './lib/stale-chunk'
import { watchSystem } from './lib/theme'
import { registerWebMcpTools } from './lib/webmcp'

watchSystem()
registerWebMcpTools()
watchStaleChunks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)