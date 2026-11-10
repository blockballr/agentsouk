// the design ships two registers. Midnight is the house default; the light one is
// there for anyone who reads on paper, and "system" hands the decision to the OS.
export type ThemeChoice = 'light' | 'system' | 'dark'

const KEY = 'agentsouk.theme'
const COOKIE = 'agentsouk_theme'

function readCookie(): ThemeChoice | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)agentsouk_theme=(light|dark|system)/)
  return match ? (match[1] as ThemeChoice) : null
}

function writeCookie(c: ThemeChoice) {
  if (typeof document === 'undefined') return
  // the marketing page and the app live on different hosts, and localStorage is
  // per-origin: a cookie on the shared domain carries the choice across the hop
  const domain = location.hostname.endsWith('agentsouk.xyz') ? '; domain=.agentsouk.xyz' : ''
  document.cookie = `${COOKIE}=${c}; path=/; max-age=31536000; samesite=lax${domain}`
}

export function getChoice(): ThemeChoice {
  // the shared-domain cookie wins: a choice made on another host is newer than
  // whatever this origin's localStorage last remembered
  const fromCookie = readCookie()
  if (fromCookie) return fromCookie
  try {
    const c = localStorage.getItem(KEY)
    if (c === 'light' || c === 'dark' || c === 'system') return c
  } catch {
    // storage unavailable; the default below is the floor
  }
  return 'dark'
}

export function setChoice(c: ThemeChoice) {
  try {
    localStorage.setItem(KEY, c)
  } catch {
    // storage unavailable; still apply for the session
  }
  writeCookie(c)
  apply(c)
}

function prefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
}

// the stored choice names the register; "system" follows the OS rather than
// assuming the dark one, so a light-mode machine opens light
export function apply(c: ThemeChoice) {
  const resolved = c === 'system' ? (prefersLight() ? 'light' : 'dark') : c
  document.documentElement.dataset.theme = resolved
}

// a system choice has to keep following, so the listener only re-applies while the
// choice is still on system; a pick made on the control is the user's, not the OS's
export function watchSystem() {
  if (typeof matchMedia !== 'function') return
  const mq = matchMedia('(prefers-color-scheme: light)')
  const onChange = () => {
    if (getChoice() === 'system') apply('system')
  }
  mq.addEventListener('change', onChange)
}
