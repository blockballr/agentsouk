import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { chainLabel } from '../lib/contracts'
import { shortAddress } from '@agora/core'
import { connectWallet } from '../lib/wallet-session'
import { useConnectedAccount } from '../lib/use-connected-account'
import { Btn, Txt } from './souk'
import { useI18n } from '../lib/i18n'

// The workspace frame: one rail down the left, one view on the right. Every
// surface a wallet owns (profile, vault, studio, docs) lives inside it, so the
// rail keeps who you are and where you can go in sight rather than repeating a
// connect button on each page.

type RailItem = { to: string; key: string; soon?: boolean; end?: boolean; accent?: 'indigo' }

const RAIL: { title: string; items: RailItem[] }[] = [
  {
    title: 'rail.console',
    items: [
      // the board is the profile, rebuilt: one surface, not a listings page plus a board
      { to: '/seller', key: 'rail.overview', end: true },
      { to: '/quest', key: 'rail.quest' },
      { to: '/studio', key: 'rail.studio', soon: true },
    ],
  },
  {
    title: 'rail.hires',
    items: [
      { to: '/vault', key: 'rail.vault' },
      { to: '/ongoing', key: 'rail.ongoing' },
    ],
  },
  {
    title: 'rail.listings',
    items: [
      { to: '/build', key: 'rail.build' },
      { to: '/list', key: 'rail.list' },
    ],
  },
  {
    title: 'rail.reference',
    items: [{ to: '/docs', key: 'rail.docs', accent: 'indigo' }],
  },
  {
    title: 'rail.account',
    items: [
      { to: '/account', key: 'rail.manage' },
      { to: '/settings', key: 'rail.settings' },
    ],
  },
]

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID ?? 56)

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  const account = useConnectedAccount()
  const [connecting, setConnecting] = useState(false)

  async function onConnect() {
    setConnecting(true)
    try {
      await connectWallet()
    } catch {
      // the wallet's own refusal is the useful message; the page stays as it was
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full gap-8 pb-24 pt-8">
      <aside className="hidden w-[236px] shrink-0 md:block">
        <div className="sticky top-24">
          <div className="rounded-none border border-souk-hair bg-souk-surface1/60 px-3 py-3">
            <Txt size={13} lead={18} weight="bold" tone="ink">
              Agent Souk
            </Txt>
            <Txt size={11} lead={16} mono tone="muted" className="mt-0.5 block">
              {chainLabel(CHAIN)}
            </Txt>
          </div>

          <nav className="mt-6 grid gap-6">
            {RAIL.map((group) => (
              <div key={group.title} className="grid gap-1.5">
                <Txt size={10} lead={14} mono upper tone="labels" className="px-3">
                  {t(group.title)}
                </Txt>
                {group.items.map((item) => (
                  <RailLink key={item.to} item={item} />
                ))}
              </div>
            ))}
          </nav>

          <div className="mt-8 rounded-none border border-souk-hair px-3 py-3">
            {account ? (
              <>
                <Txt size={10} lead={14} mono upper tone="labels">
                  {t('rail.connected')}
                </Txt>
                <Txt size={12} lead={18} mono tone="slate" className="mt-1 block">
                  {shortAddress(account)}
                </Txt>
              </>
            ) : (
              <>
                <Txt size={11} lead={16} tone="muted">
                  {t('rail.noWallet')}
                </Txt>
                <Btn kind="primary" onClick={() => void onConnect()} disabled={connecting} className="mt-2 w-full">
                  {connecting ? t('rail.connecting') : t('rail.connect')}
                </Btn>
              </>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <nav className="mb-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {RAIL.flatMap((g) => g.items).map((item) => (
            <RailLink key={item.to} item={item} chip />
          ))}
        </nav>
        {!account && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-none border border-souk-hair px-4 py-3 md:hidden">
            <Txt size={12} lead={18} tone="muted">
              {t('rail.noWallet')}
            </Txt>
            <Btn kind="primary" onClick={() => void onConnect()} disabled={connecting}>
              {connecting ? t('rail.connecting') : t('rail.connect')}
            </Btn>
          </div>
        )}
        {children ?? <Outlet />}
      </div>
    </div>
  )
}

function RailLink({ item, chip }: { item: RailItem; chip?: boolean }) {
  const { t } = useI18n()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          chip
            ? 'shrink-0 rounded-full border px-3 py-1.5 text-[12px]'
            : 'rounded-none border px-3 py-2 text-[13px]',
          item.accent === 'indigo'
            ? isActive
              ? 'border-souk-indigo/40 bg-souk-indigo/15 text-souk-indigo-link'
              : 'border-transparent text-souk-indigo-link hover:bg-souk-indigo/10'
            : isActive
              ? 'border-souk-hair bg-souk-surface2 text-souk-ink'
              : 'border-transparent text-souk-slate hover:bg-souk-surface2/60 hover:text-souk-ink',
        ].join(' ')
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span>{t(item.key)}</span>
        {item.soon ? (
          <span className="rounded-full border border-souk-hair px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-souk-muted">
            {t('rail.soon')}
          </span>
        ) : null}
      </span>
    </NavLink>
  )
}
