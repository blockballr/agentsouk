import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { chainLabel } from '../lib/contracts'
import { shortAddress } from '@agora/core'
import { connectWallet } from '../lib/wallet-session'
import { useConnectedAccount } from '../lib/use-connected-account'
import { Btn, Txt } from './souk'

// The workspace frame: one rail down the left, one view on the right. Every
// surface a wallet owns (profile, vault, studio, docs) lives inside it, so the
// rail keeps who you are and where you can go in sight rather than repeating a
// connect button on each page.

type RailItem = { to: string; label: string; note?: string; soon?: boolean; end?: boolean }

const RAIL: { title: string; items: RailItem[] }[] = [
  {
    title: 'Marketplace',
    items: [
      { to: '/profile', label: 'Overview', note: 'your listings and earnings', end: true },
      { to: '/agents', label: 'Browse agents' },
      { to: '/ongoing', label: 'Ongoing hires' },
      { to: '/vault', label: 'Vault' },
    ],
  },
  {
    title: 'Build',
    items: [
      { to: '/studio', label: 'Studio', note: 'commissions and dry runs', soon: true },
      { to: '/docs', label: 'Docs' },
      { to: '/list', label: 'List an agent' },
    ],
  },
]

const CHAIN = Number(import.meta.env.VITE_CHAIN_ID ?? 56)

export function WorkspaceShell({ children }: { children?: ReactNode }) {
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
    <div className="mx-auto flex w-full max-w-[1400px] gap-8 px-4 pb-24 pt-8 lg:px-8">
      <aside className="hidden w-[236px] shrink-0 md:block">
        <div className="sticky top-24">
          <div className="rounded-2xl border border-souk-hair bg-souk-surface1/60 px-3 py-3">
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
                  {group.title}
                </Txt>
                {group.items.map((item) => (
                  <RailLink key={item.to} item={item} />
                ))}
              </div>
            ))}
          </nav>

          <div className="mt-8 rounded-2xl border border-souk-hair px-3 py-3">
            {account ? (
              <>
                <Txt size={10} lead={14} mono upper tone="labels">
                  connected
                </Txt>
                <Txt size={12} lead={18} mono tone="slate" className="mt-1 block">
                  {shortAddress(account)}
                </Txt>
              </>
            ) : (
              <>
                <Txt size={11} lead={16} tone="muted">
                  No wallet connected.
                </Txt>
                <Btn kind="primary" onClick={() => void onConnect()} disabled={connecting} className="mt-2 w-full">
                  {connecting ? 'Connecting...' : 'Connect wallet'}
                </Btn>
              </>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <nav className="mb-6 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {RAIL.flatMap((g) => g.items).map((item) => (
            <RailLink key={item.to} item={item} chip />
          ))}
        </nav>
        {children ?? <Outlet />}
      </div>
    </div>
  )
}

function RailLink({ item, chip }: { item: RailItem; chip?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          chip
            ? 'shrink-0 rounded-full border px-3 py-1.5 text-[12px]'
            : 'rounded-xl border px-3 py-2 text-[13px]',
          isActive
            ? 'border-souk-hair bg-souk-surface2 text-souk-ink'
            : 'border-transparent text-souk-slate hover:bg-souk-surface2/60 hover:text-souk-ink',
        ].join(' ')
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span>{item.label}</span>
        {item.soon ? (
          <span className="rounded-full border border-souk-hair px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-souk-muted">
            soon
          </span>
        ) : null}
      </span>
      {item.note && !chip ? (
        <span className="mt-0.5 block text-[11px] leading-4 text-souk-muted">{item.note}</span>
      ) : null}
    </NavLink>
  )
}
