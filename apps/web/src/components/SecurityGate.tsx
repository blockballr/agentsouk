// The gate runs beside the app, never in front of it.
import { useCallback, useEffect, useState } from 'react'
import { TURNSTILE_ENABLED, Turnstile } from './Turnstile'
import { verifyTurnstile } from '../lib/api'

const PASS_KEY = 'agentsouk.gate.passed'
const GATE_HOSTS = new Set(['app.agentsouk.xyz', 'station.agentsouk.xyz'])
const WIDGET_DELAY_MS = 4_000

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
  // ?gate in local development shows the same widget without the app domain
  const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('gate')
  const gated = TURNSTILE_ENABLED && (GATE_HOSTS.has(window.location.hostname) || preview)
  const [passed, setPassed] = useState(() => !gated || passedThisSession())
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!gated || passed) return
    const id = window.setTimeout(() => setArmed(true), WIDGET_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [gated, passed])

  const onToken = useCallback(async (token: string) => {
    if (!token) return
    try {
      if (await verifyTurnstile(token)) {
        rememberPass()
        setPassed(true)
      }
    } catch {
      // the widget owns the retry state; a failed verification leaves it running
    }
  }, [])

  return (
    <>
      {children}
      {gated && !passed && armed && (
        <div className="pointer-events-none fixed bottom-0 right-0 z-[200] h-px w-px overflow-hidden opacity-0" aria-hidden="true">
          <Turnstile theme="dark" className="" onToken={onToken} />
        </div>
      )}
    </>
  )
}
