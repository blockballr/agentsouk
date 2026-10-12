// one register: dark. The design has no light variant, so applying always names dark
// and there is nothing for the system listener to follow.
export type ThemeChoice = 'light' | 'system' | 'dark'

const KEY = 'agentsouk.theme'

export function getChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY)
    return c === 'light' || c === 'dark' || c === 'system' ? c : 'dark'
  } catch {
    return 'dark'
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

export function apply(_c: ThemeChoice) {
  document.documentElement.dataset.theme = 'dark'
}

export function watchSystem() {}
