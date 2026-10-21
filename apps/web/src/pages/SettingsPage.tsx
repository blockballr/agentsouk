import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconChevron, Row, SectionHead, Stack, Txt } from '../components/souk'
import { LOCALES, useI18n, type LocaleCode } from '../lib/i18n'

// Settings is the list of account preferences, not the key desk: keys and
// addresses live in Manage account, which the second row leads to.
export function SettingsPage() {
  const { locale, setLocale, t } = useI18n()

  return (
    <Stack gap={20} className="mx-auto max-w-[760px] pt-8">
      <SectionHead title={t('settings.title')} note={t('settings.preferences')} />

      <Stack surface radius={16} className="overflow-hidden">
        <Row
          justify="between"
          align="center"
          gap={16}
          className="min-h-[64px] border-b border-souk-hair px-5 py-3"
        >
          <Row align="center" gap={12}>
            <GlobeGlyph />
            <Txt size={13} lead={20} tone="ink">
              {t('settings.language')}
            </Txt>
          </Row>
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
        </Row>

        <SettingsLink to="/settings/profile" label={t('settings.profile')} Glyph={PersonGlyph} />
        <SettingsLink to="/account" label={t('settings.account')} Glyph={WalletGlyph} />
        <SettingsLink to="/settings/security" label={t('settings.security')} Glyph={ShieldGlyph} last />
      </Stack>

      <Txt size={12} lead={18} tone="muted">
        {t('settings.note')}
      </Txt>
    </Stack>
  )
}

function SettingsLink({
  to,
  label,
  Glyph,
  last,
}: {
  to: string
  label: string
  Glyph: () => ReactNode
  last?: boolean
}) {
  return (
    <Link
      to={to}
      className={`flex min-h-[64px] items-center gap-3 px-5 py-3 transition-colors hover:bg-souk-surface2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-souk-data ${
        last ? '' : 'border-b border-souk-hair'
      }`}
    >
      <Glyph />
      <Txt size={13} lead={20} tone="ink" className="flex-1">
        {label}
      </Txt>
      <IconChevron className="rotate-[-90deg] text-souk-muted" />
    </Link>
  )
}

function GlobeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-souk-steel" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  )
}

function PersonGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-souk-steel" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function WalletGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-souk-steel" aria-hidden="true">
      <path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5" />
      <circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ShieldGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-souk-steel" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
    </svg>
  )
}
