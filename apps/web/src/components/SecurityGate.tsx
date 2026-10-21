// The gate a new browser session passes before the app renders on the app,
// docs and station hosts. It is a Turnstile check, verified server-side, and
// the pass is kept in sessionStorage so reloads inside the same session do not
// ask again. Each host is its own origin, so each asks once. Local development
// is not gated unless the URL carries ?gate.
import { useCallback, useState } from 'react'
import { TURNSTILE_ENABLED, Turnstile } from './Turnstile'
import { verifyTurnstile } from '../lib/api'

const PASS_KEY = 'agentsouk.gate.passed'
const GATE_HOSTS = new Set(['app.agentsouk.xyz', 'docs.agentsouk.xyz', 'station.agentsouk.xyz'])

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
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const onToken = useCallback(
    async (token: string) => {
      if (!token) {
        setError('The check expired. Tick the box to try again.')
        return
      }
      setChecking(true)
      setError('')
      try {
        if (await verifyTurnstile(token)) {
          rememberPass()
          setPassed(true)
        } else {
          setError('The check did not pass. Tick the box to try again.')
        }
      } catch {
        setError('The check could not be completed. Try again in a moment.')
      } finally {
        setChecking(false)
      }
    },
    [],
  )

  if (passed) return <>{children}</>

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-[#0b0b0c] px-5 text-center">
      <h1 className="max-w-xl text-balance text-xl font-semibold text-white sm:text-2xl">
        Quick security check to keep Agent Souk safe
      </h1>
      <div className="w-full max-w-[420px] rounded-xl border border-white/15 bg-[#1c1c1f] px-4 py-5 shadow-2xl">
        <Turnstile theme="dark" className="flex min-h-[65px] items-center justify-center" onToken={onToken} />
        {checking && <p className="mt-2 text-xs text-white/60">Checking...</p>}
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
      <p className="max-w-sm text-xs leading-relaxed text-white/40">
        Protected by Cloudflare. This check runs once per browser session.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-xs text-white/35 underline underline-offset-4 transition-colors hover:text-white/60"
      >
        Reload the check
      </button>
    </div>
  )
}
