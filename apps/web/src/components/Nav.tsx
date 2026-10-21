import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import { QuickSearch } from './QuickSearch'

import { NotificationBell } from './NotificationBell'
import { Wordmark } from './Wordmark'
import { connectWallet, disconnectWallet, signOut } from '../lib/wallet-session'
import { useActiveAccount } from '../lib/use-active-account'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { useLocalProfile } from '../lib/profile'
import { useI18n } from '../lib/i18n'
import { Dot, Row, Rule, Stack, Txt } from './souk'

const links = [
  { to: '/agents', key: 'nav.marketplace' },
  { to: '/compare', key: 'nav.compare' },
  { to: '/build', key: 'nav.build' },
  { to: '/ongoing', key: 'nav.ongoing' },
  { to: '/quest', key: 'nav.quest' },
]

// the design's top bar item: upper case, and the active one is the only ink in the
// row with a rule under it. Steel is the resting tone so the current page reads at a
// glance rather than every item competing. The rule sits in the 5px gap the design
// leaves under the label, not tight against it.
const itemClass = (isActive: boolean): string =>
  `border-b-2 pb-[5px] text-[13px] uppercase leading-[18px] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data ${
    isActive
      ? 'border-souk-data font-semibold text-souk-ink'
      : 'border-transparent text-souk-steel hover:text-souk-ink'
  }`

// the bar's control squares: the design's 38 tall and 38 wide, an 8 radius, one 16%
// rim. the square has to be stated in both axes, or a link sized to its icon collapses
// to the glyph's width and reads as a sliver beside the real squares
const controlClass =
  'relative flex h-[38px] w-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] border border-souk-hair text-souk-steel transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data hover:border-souk-data/50'

// the profile chip: wider than a square, because the design puts the mark and the
// connected address in it rather than an icon alone
const profileClass =
  'flex h-[38px] shrink-0 items-center gap-2 rounded-[8px] border border-souk-hair pl-2.5 pr-3.5 text-souk-steel transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data hover:border-souk-data/50'

export function Nav() {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  // a declined sign-in surfaces here, where the connect click happened
  const [connectError, setConnectError] = useState<string | null>(null)
  // the profile chip says the signed-in address rather than spelling out Profile:
  // the session is watched, so a switch inside the wallet adopts a recorded
  // address or disconnects rather than moving the chip to whoever is active
  const wallet = useActiveAccount()
  return (
    <header className="relative z-10 border-b border-souk-hair bg-souk-canvas">
      <div className="mx-auto flex h-[62px] items-center justify-between px-4 lg:px-8">
        {/* left: the wordmark and the section links, the design's first cluster */}
        <div className="flex items-center gap-[44px]">
          <Wordmark />
          <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => itemClass(isActive)}>
                {t(l.key)}
              </NavLink>
            ))}
            {/* the plain text links belong in this one row: a group that also holds
                the boxed controls is taller, so its text centres against a different
                box height and the row reads misaligned */}
            <ChainTag />
          </nav>
        </div>

        {/* a declined sign-in must say so where the connect click happened, but as a
            notice that leaves on its own, never a permanent resident of the bar */}
        <ConnectNotice message={connectError} onDismiss={() => setConnectError(null)} />

        {/* right: the controls. The design draws them as the bar's second cluster, so
            they are a sibling of the wordmark group and the space between pins them to
            the far edge rather than to the end of the links */}
        <div className="hidden lg:flex lg:items-center lg:gap-2.5">
          <QuickSearch />
          <NotificationBell />
          <ProfileChip
            wallet={wallet}
            onConnect={() => {
              connectWallet()
                .then(() => setConnectError(null))
                .catch((e) =>
                  setConnectError(
                    e instanceof Error ? e.message : 'Sign-in was declined, connect again to sign in.',
                  ),
                )
            }}
          />
        </div>

        <div className="lg:hidden">
          <QuickSearch large />
        </div>
        <button
          type="button"
          aria-label={menuOpen ? t('nav.menu.close') : t('nav.menu.open')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data lg:hidden"
        >
          <MenuIcon />
        </button>
      </div>

      {menuOpen && (
        <div className="border-b border-souk-hair bg-souk-canvas lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex flex-col gap-1 px-4 lg:px-8 py-4">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `py-3 text-[15px] uppercase ${
                    isActive ? 'font-semibold text-souk-ink' : 'text-souk-steel'
                  } focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data`
                }
              >
                {t(l.key)}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center gap-6 py-3">
              <ChainTag />
              {/* phones reach the account through the page; the panel is the wide bar's
                  affordance, so the mobile row links straight there */}
              <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={itemClass(false)}>
                {t('nav.profile')}
              </NavLink>
              <NotificationBell />
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

function ChainTag() {
  const { t } = useI18n()
  const target = useTargetChain()
  const on = target?.chainId === 56
  const test = Boolean(target) && !on
  // which chain the site is settling on, said in the bar: the campaign runs on
  // mainnet and a quester needs to know it before signing anything
  return (
    <span
      title={target ? `Settling on ${chainLabel(target.chainId)} · chain ${target.chainId}` : t('nav.chain.reading')}
      className="inline-flex shrink-0 items-center gap-2 rounded-[8px] border border-souk-hair px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase leading-[14px] text-souk-steel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Dot tone={on ? 'good' : test ? 'sky' : 'quiet'} size={6} />
      {target ? (on ? t('nav.chain.mainnet', { id: target.chainId }) : t('nav.chain.testnet', { id: target.chainId })) : t('nav.chain.reading')}
    </span>
  )
}

function PersonGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function VaultGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaf2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  )
}

function PlusGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaf2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PowerGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f2936b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v9" />
      <path d="M6.6 6.6a8 8 0 1 0 10.8 0" />
    </svg>
  )
}

// one account row: the bold label over its own mono route, in the design's 40 tall
function AccountRow({ label, route, Icon }: { label: string; route: string; Icon: () => ReactNode }) {
  return (
    <Link
      to={route}
      className="flex h-[40px] items-center gap-2.5 rounded-[8px] px-2 text-souk-indigo-labels transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Icon />
      <Stack gap={1}>
        <Txt size={13} lead={18} weight="bold" tone="white">
          {label}
        </Txt>
        <Txt size={10} lead={14} mono tone="indigo-labels">
          {route}
        </Txt>
      </Stack>
    </Link>
  )
}

// the account panel: the same shell the outbox dropdown wears (indigo navy, one rim
// of white at 16 on every edge, a 20 radius), so the two can never drift apart
function ProfileChip({ wallet, onConnect }: { wallet: string | null; onConnect: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  // the picture set in Settings/profile rides the chip and the panel head, so the
  // same mark a seller chose is the one the bar shows
  const profile = useLocalProfile(wallet)
  // the panel names the chain the deployment actually serves, read from the server
  // rather than compiled in, so it cannot claim a chain the instance is not on
  const target = useTargetChain()
  useEffect(() => {
    if (!open) return
    const onAway = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onAway)
    return () => document.removeEventListener('mousedown', onAway)
  }, [open])
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={wallet ? (profile?.username ? `${profile.username}, account menu` : 'Account menu') : t('nav.profile')}
        // the mark carries the chip whether or not a wallet is picked, and the address
        // joins it the moment one is; the panel opens either way, connect included
        onClick={() => setOpen((v) => !v)}
        className={wallet ? profileClass : controlClass}
      >
        {profile?.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            className="h-[22px] w-[22px] shrink-0 rounded-full object-cover"
          />
        ) : (
          <PersonGlyph />
        )}
        {wallet ? (
          <Txt size={12} lead={18} mono tone="white">
            {shortAddress(wallet)}
          </Txt>
        ) : null}
      </button>

      {open && (
        <Stack
          radius={20}
          hair
          pad={[14, 16, 14, 16]}
          gap={2}
          className="absolute right-0 top-full z-50 mt-2 w-[300px] bg-souk-indigo/85 shadow-lg backdrop-blur-md ring-1 ring-white/10"
        >
          <Row align="center" pad={[0, 8, 8, 8]} gap={10} className="text-souk-indigo-labels">
            {profile?.avatar ? (
              <img
                src={profile.avatar}
                alt=""
                className="h-[26px] w-[26px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <PersonGlyph />
            )}
            <Stack gap={2}>
              <Txt size={12} lead={18} mono tone="white">
                {profile?.username || (wallet ? shortAddress(wallet) : t('nav.account.notConnected'))}
              </Txt>
              <Txt size={10} lead={14} weight="bold" upper tone="indigo-labels">
                {wallet
                  ? target
                    ? t('nav.account.connectedTo', { chain: chainLabel(target.chainId) })
                    : t('nav.account.connected')
                  : t('nav.account.connectToList')}
              </Txt>
            </Stack>
          </Row>
          <Rule hair />
          <AccountRow label={t('nav.account.profile')} route="/profile" Icon={PersonGlyph} />
          <AccountRow label={t('nav.account.vault')} route="/vault" Icon={VaultGlyph} />
          <AccountRow label={t('nav.account.list')} route="/list" Icon={PlusGlyph} />
          <Rule hair />
          {wallet ? (
            <button
              type="button"
              onClick={() => {
                // forget this browser: the session, the wallet choice and the
                // record go, so a reload stays disconnected
                signOut()
                disconnectWallet()
                setOpen(false)
                window.location.reload()
              }}
              className="flex h-[40px] w-full items-center gap-2.5 rounded-[8px] px-2 text-[13px] font-bold text-souk-peach transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
            >
              {/* the one row that never navigates */}
              <PowerGlyph />
              {t('nav.account.disconnect')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onConnect()
              }}
              className="flex h-[40px] w-full items-center gap-2.5 rounded-[8px] px-2 text-[13px] font-bold text-souk-data transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
            >
              <PersonGlyph />
              {t('nav.account.connect')}
            </button>
          )}
        </Stack>
      )}
    </div>
  )
}

function MenuIcon() {
  return (
    <svg
      width="18"
      height="14"
      viewBox="0 0 18 14"
      fill="none"
      aria-hidden="true"
    >
      <path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

// The connect fault says its piece under the bar and then gets out of the way:
// it fades on its own, leaves the header's layout alone, and a click sends it
// early. A new message restarts the cycle instead of stacking a second notice.
function ConnectNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  useEffect(() => {
    if (!message) return
    setVisible(true)
    const fade = setTimeout(() => setVisible(false), 5500)
    const gone = setTimeout(() => dismissRef.current(), 6000)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [message])

  if (!message) return null
  return (
    <p
      role="status"
      onClick={() => dismissRef.current()}
      className={`fixed left-1/2 top-[76px] z-[60] w-max max-w-[min(92vw,560px)] -translate-x-1/2 cursor-pointer rounded-[10px] border border-souk-peach/40 bg-souk-surface2 px-4 py-3 text-center text-[13px] leading-[18px] text-souk-peach shadow-lg transition-opacity duration-300 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {message}
    </p>
  )
}
