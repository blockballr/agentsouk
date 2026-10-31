import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/jetbrains-mono'
import './theme.css'
import App from './App'
import { LocaleProvider } from './lib/i18n'
import { watchStaleChunks } from './lib/stale-chunk'
import { watchSystem } from './lib/theme'
import { registerWebMcpTools } from './lib/webmcp'

watchSystem()
registerWebMcpTools()
watchStaleChunks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
)

// the boot shell covers the app until the first frame is painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => document.getElementById('boot-shell')?.remove())
})