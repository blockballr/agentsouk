import { useCallback, useEffect, type ReactNode } from 'react'
import i18n from 'i18next'
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next'
import { LOCALES, readLocale, writeLocale, type LocaleCode } from './locale'
import en from '../locales/en.json'
import es from '../locales/es.json'
import fr from '../locales/fr.json'
import de from '../locales/de.json'
import pt from '../locales/pt-BR.json'
import ja from '../locales/ja.json'
import zh from '../locales/zh.json'

// The interface language is a stored preference. The dictionaries cover the
// chrome, the settings surface and the vault form; long-form copy and agent
// listings stay in the language their authors wrote them in. i18next does the
// lookup, fallback and interpolation; the keys stay flat and dotted so the
// existing call sites read the same.
const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  'pt-BR': { translation: pt },
  ja: { translation: ja },
  zh: { translation: zh },
}

void i18n.use(initReactI18next).init({
  resources,
  lng: readLocale(),
  fallbackLng: 'en',
  supportedLngs: LOCALES.map((l) => l.code),
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

type I18nValue = {
  locale: LocaleCode
  setLocale: (code: LocaleCode) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const sync = (lng: string): void => {
      document.documentElement.lang = lng
    }
    sync(i18n.resolvedLanguage ?? i18n.language)
    i18n.on('languageChanged', sync)
    return () => {
      i18n.off('languageChanged', sync)
    }
  }, [])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}

export function useI18n(): I18nValue {
  const { t: translate, i18n: instance } = useTranslation()
  const locale = (instance.resolvedLanguage ?? instance.language ?? 'en') as LocaleCode

  const setLocale = useCallback(
    (code: LocaleCode) => {
      void instance.changeLanguage(code)
      writeLocale(code)
    },
    [instance],
  )

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => String(translate(key, vars)),
    [translate],
  )

  return { locale, setLocale, t }
}

export { LOCALES }
export type { LocaleCode }
