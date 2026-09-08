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

export function apply(c: ThemeChoice) {
  const resolved =
    c === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : c
  document.documentElement.dataset.theme = resolved
}

export function watchSystem() {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getChoice() === 'system') apply('system')
  })
}
