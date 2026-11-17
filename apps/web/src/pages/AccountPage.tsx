import { useSearchParams } from 'react-router-dom'
import { ThemeToggle } from '../components/ThemeToggle'
import { LOCALES, useI18n, type LocaleCode } from '../lib/i18n'
import { ManageAccountPage } from './ManageAccountPage'
import { SettingsProfilePage } from './SettingsProfilePage'

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'keys', label: 'Keys and custom agents' },
  { key: 'preferences', label: 'Preferences' },
] as const

type Tab = (typeof TABS)[number]['key']

function Preferences() {
  const { locale, setLocale, t } = useI18n()
  return (
    <section className="divide-y divide-souk-hair rounded-[14px] border border-souk-hair">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <span>
          <span className="block text-[14px] font-semibold text-souk-ink">{t('settings.language')}</span>
          <span className="block text-[12.5px] text-souk-steel">Menus, settings and forms. Agent descriptions stay as their authors wrote them.</span>
        </span>
        <select
          aria-label={t('settings.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as LocaleCode)}
          className="h-9 min-w-[190px] rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 text-[13px] text-souk-ink outline-none focus-visible:border-souk-data"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <span>
          <span className="block text-[14px] font-semibold text-souk-ink">Theme</span>
          <span className="block text-[12.5px] text-souk-steel">Light, dark or your system's choice.</span>
        </span>
        <ThemeToggle />
      </div>
    </section>
  )
}

// one place for the wallet's account: who you are on the marketplace, the keys of agents you built,
// and how the site looks. the tab rides the link so each part can be linked to directly
export function AccountPage() {
  const [sp, setSp] = useSearchParams()
  const tab: Tab = TABS.some((x) => x.key === sp.get('tab')) ? (sp.get('tab') as Tab) : 'profile'

  return (
    <div className="grid max-w-[920px] gap-6 pb-16">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-data">Console</p>
        <h1 className="mt-1 text-[30px] font-bold leading-[36px] text-souk-ink">Account</h1>
        <p className="mt-2 text-[15px] leading-[23px] text-souk-slate">Your name and picture, the keys of agents you built, and how the site looks.</p>
      </header>

      <div role="tablist" aria-label="Account sections" className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => setSp(x.key === 'profile' ? {} : { tab: x.key }, { replace: true })}
            className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              tab === x.key ? 'border-souk-data/60 bg-souk-surface2 text-souk-ink' : 'border-souk-hair text-souk-slate hover:text-souk-ink'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? <SettingsProfilePage embedded /> : tab === 'keys' ? <ManageAccountPage embedded /> : <Preferences />}
    </div>
  )
}
