// Every deploy replaces every hashed asset, so a tab still holding an older build
// asks for chunk names that no longer exist and its dynamic imports fail. One
// reload picks up the current build; the timestamp stops a loop when a chunk is
// genuinely gone rather than merely stale.
const STAMP = 'agentsouk.chunk-reload-at'
const WINDOW_MS = 30_000

// A settlement signature exists only in memory until the settle call broadcasts
// it, so a reload while a hire is signing or settling would destroy the payment.
// The hire runner raises this flag for that whole window and the reload below
// stands down while it is up. Exported so the runner and the guard share one key.
export const PAYMENT_IN_FLIGHT_KEY = 'agentsouk.payment-in-flight'

// sessionStorage throws in a locked down browser, so a failed read counts as no
// marker and a failed write is ignored rather than breaking a payment.
export function paymentInFlight(): boolean {
  try {
    return sessionStorage.getItem(PAYMENT_IN_FLIGHT_KEY) === '1'
  } catch {
    return false
  }
}

export function setPaymentInFlight(active: boolean): void {
  try {
    if (active) sessionStorage.setItem(PAYMENT_IN_FLIGHT_KEY, '1')
    else sessionStorage.removeItem(PAYMENT_IN_FLIGHT_KEY)
  } catch {
    // storage unavailable: the guard stays armed, which cannot lose a signature
  }
}

// no hire can be in flight before the page has loaded, so a tab that was reloaded
// mid-hire clears the marker here rather than blocking the next stale chunk
setPaymentInFlight(false)

export function reloadOnceForStaleChunk(): boolean {
  try {
    if (paymentInFlight()) return false
    const last = Number(sessionStorage.getItem(STAMP) ?? '0')
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(STAMP, String(Date.now()))
    window.location.reload()
    return true
  } catch {
    return false
  }
}

// Vite raises this when a dynamic import or a module preload cannot be fetched.
export function watchStaleChunks(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForStaleChunk()) event.preventDefault()
  })
}
