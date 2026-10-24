// The gate a new browser session passes before the app renders on the app and
// station hosts. It is a Turnstile check, verified server-side, and the pass is
// kept in sessionStorage so reloads inside the same session do not ask again.
// Docs is deliberately ungated: it is public documentation and agents must be
// able to read it without running a browser challenge. Local development is not
// gated unless the URL carries ?gate.
import { useCallback, useState } from 'react'
import { TURNSTILE_ENABLED, Turnstile } from './Turnstile'
import { verifyTurnstile } from '../lib/api'

const PASS_KEY = 'agentsouk.gate.passed'
const GATE_HOSTS = new Set(['app.agentsouk.xyz', 'station.agentsouk.xyz'])

// storage can throw when a browser blocks it; a blocked store simply means the
// check runs again rather than the app failing to mount
function passedThisSession(): boolean {
  try {
    return sessionStorage.getItem(PASS_KEY) === '1'
  } catch {
    return false
  }
}

function rememberPass(): void {
  try {
    sessionStorage.setItem(PASS_KEY, '1')
  } catch {
    // the gate stays up for this tab only, which is the safe failure
  }
}

export function SecurityGate({ children }: { children: React.ReactNode }) {
  // ?gate in local development shows the same screen without the app domain
  const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('gate')
  const gated = TURNSTILE_ENABLED && (GATE_HOSTS.has(window.location.hostname) || preview)
  const [passed, setPassed] = useState(() => !gated || passedThisSession())

  const onToken = useCallback(async (token: string) => {
    if (!token) return
    try {
      if (await verifyTurnstile(token)) {
        rememberPass()
        setPassed(true)
      }
    } catch {
      // the widget owns the retry state; a failed verification leaves it up
    }
  }, [])

  if (passed) return <>{children}</>

  // Cloudflare's widget is the whole gate. No heading, card, footer or second
  // way to reload: the challenge is the interface.
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <Turnstile theme="dark" className="" onToken={onToken} />
    </div>
  )
}
