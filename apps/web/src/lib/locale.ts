// The interface language is a stored preference. The dictionary covers the
// chrome, settings and the vault form; long-form copy and agent listings stay
// in the language their authors wrote them in.
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ja', label: '日本語' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'zh', label: '中文' },
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

const KEY = 'agentsouk.locale'

export function readLocale(): LocaleCode {
  try {
    const stored = window.localStorage.getItem(KEY)
    return LOCALES.some((l) => l.code === stored) ? (stored as LocaleCode) : 'en'
  } catch {
    return 'en'
  }
}

export function writeLocale(code: LocaleCode): void {
  try {
    window.localStorage.setItem(KEY, code)
  } catch {
    // a browser that refuses storage still gets the language for this visit
  }
  document.documentElement.lang = code
}
