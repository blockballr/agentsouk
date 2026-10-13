// the design ships two registers: the dark one and a light one for anyone who reads
// on paper. The choice is stored, and "system" hands the decision to the OS.
export type ThemeChoice = 'light' | 'system' | 'dark'

const KEY = 'agentsouk.theme'

export function getChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY)
    return c === 'light' || c === 'dark' || c === 'system' ? c : 'system'
  } catch {
    return 'system'
  }
}

export function setChoice(c: ThemeChoice) {
  try {
    localStorage.setItem(KEY, c)
  } catch {
    // storage unavailable; still apply for the session
  }
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
