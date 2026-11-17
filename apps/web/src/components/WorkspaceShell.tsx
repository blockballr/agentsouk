import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { chainLabel } from '../lib/contracts'
import { shortAddress } from '@agora/core'
import { connectWalletWithTimeout } from '../lib/wallet-session'
import { walletErrorText } from '../lib/wallet-errors'
import { useConnectedAccount } from '../lib/use-connected-account'
import { Btn, Txt } from './souk'
import { useI18n } from '../lib/i18n'

// The workspace frame: one rail down the left, one view on the right. Every
// surface a wallet owns (profile, vault, studio, docs) lives inside it, so the
// rail keeps who you are and where you can go in sight rather than repeating a
// connect button on each page.

type RailItem = { to: string; key: string; soon?: boolean; end?: boolean; accent?: 'indigo' }

// what a person came to do, in their words
// starting a vault hire, a guard or a listing lives next to what it creates, and docs sit in the status bar
// the executor sessions page is a team tool reached by its address, so it is not offered here
const RAIL: { title: string; items: RailItem[] }[] = [
  {
    title: 'rail.console',
    items: [
      { to: '/home', key: 'rail.home', end: true },
      { to: '/ongoing', key: 'rail.myHires' },
      { to: '/seller', key: 'rail.myAgents', end: true },
    ],
  },
  {
    title: 'rail.account',
    items: [{ to: '/account', key: 'rail.accountPage', end: true }],
  },
]

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID ?? 56)

export function WorkspaceShell({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  const account = useConnectedAccount()
  const [connecting, setConnecting] = useState(false)
  // what a dead connect has to say for itself; set only by the connect timeout,
  // so the rail never claims a wallet it did not see
  const [connectNote, setConnectNote] = useState<string | null>(null)
  // /build asks for the wallet inside its first step and Home leads with its own connect card,
  // so the rail does not offer a second button that pulls the eye away from it
  const pathname = useLocation().pathname
  const pageOwnsConnect = pathname === '/build' || pathname === '/home'

  async function onConnect() {
    setConnecting(true)
    setConnectNote(null)
    try {
      await connectWalletWithTimeout()
    } catch (e) {
      setConnectNote(walletErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full gap-8 pb-24 pt-8">
      <aside className="hidden w-[236px] shrink-0 md:block">
        <div className="sticky top-24">
          {/* the wallet sits first: every page here asks for it, so it is never below the fold */}
          <div className="souk-glass rounded-[16px] border border-souk-hair px-3 py-3">
            <Txt size={11} lead={16} mono tone="muted" className="block">
              Agent Souk, {chainLabel(CHAIN)}
            </Txt>
            {account ? (
              <>
                <Txt size={10} lead={14} mono upper tone="labels" className="mt-2 block">
                  {t('rail.connected')}
                </Txt>
                <Txt size={12} lead={18} mono tone="slate" className="mt-1 block">
                  {shortAddress(account)}
                </Txt>
              </>
            ) : (
              <>
                <Txt size={11} lead={16} tone="muted" className="mt-2 block">
                  {connectNote ?? t('rail.noWallet')}
                </Txt>
                {pageOwnsConnect ? null : (
                  <Btn kind="primary" onClick={() => void onConnect()} disabled={connecting} className="mt-2 w-full">
                    {connecting ? t('rail.connecting') : t('rail.connect')}
                  </Btn>
                )}
              </>
            )}
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

        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <nav className="relative mb-4 md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {RAIL.flatMap((g) => g.items).map((item) => (
              <RailLink key={item.to} item={item} chip />
            ))}
          </div>
          {/* the right-edge fade is the affordance that the strip keeps scrolling */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-souk-canvas to-transparent"
          />
        </nav>
        {!account && !pageOwnsConnect && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-souk-hair px-4 py-3 md:hidden">
            <Txt size={12} lead={18} tone="muted">
              {connectNote ?? t('rail.noWallet')}
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
            ? 'inline-flex min-h-[36px] shrink-0 items-center rounded-full border px-3 py-1.5 text-[12px]'
            : 'rounded-[8px] border px-3 py-2 text-[13px]',
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
