// Every deploy replaces every hashed asset, so a tab still holding an older build
// asks for chunk names that no longer exist and its dynamic imports fail. One
// reload picks up the current build; the timestamp stops a loop when a chunk is
// genuinely gone rather than merely stale.
const STAMP = 'agentsouk.chunk-reload-at'
const WINDOW_MS = 30_000

export function reloadOnceForStaleChunk(): boolean {
  try {
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
