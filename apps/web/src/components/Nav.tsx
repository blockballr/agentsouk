import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import { QuickSearch } from './QuickSearch'
import { ThemeToggle } from './ThemeToggle'
import { NotificationBell } from './NotificationBell'
import { Wordmark } from './Wordmark'
import { cartCount, subscribe } from '../lib/cart'
import { connectWallet, disconnectWallet, signOut } from '../lib/wallet-session'
import { useActiveAccount } from '../lib/use-active-account'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { Dot, IconCart, SoukMark, Row, Rule, Stack, Txt } from './souk'

const links = [
  { to: '/agents', label: 'Marketplace' },
  { to: '/compare', label: 'Compare' },
  { to: '/ongoing', label: 'Ongoing' },
  { to: '/list', label: 'List agent' },
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
  'flex h-[38px] shrink-0 items-center gap-2 rounded-[8px] border border-souk-hair pl-2.5 pr-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data hover:border-souk-data/50'

export function Nav() {
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
                {l.label}
              </NavLink>
            ))}
            {/* the plain text links belong in this one row: a group that also holds
                the boxed controls is taller, so its text centres against a different
                box height and the row reads misaligned */}
            <ChainTag />
          </nav>
        </div>

        {/* a declined sign-in must say so where the connect click happened, rather
            than leave the chip unchanged with only a console rejection */}
        {connectError && (
          <p className="border-b border-souk-hair bg-souk-canvas px-4 py-2 text-[12px] text-souk-peach">
            {connectError}
          </p>
        )}

        {/* right: the controls. The design draws them as the bar's second cluster, so
            they are a sibling of the wordmark group and the space between pins them to
            the far edge rather than to the end of the links */}
        <div className="hidden lg:flex lg:items-center lg:gap-2.5">
          <ThemeToggle />
          <QuickSearch />
          <NotificationBell />
          <CartLink />
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
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
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
                {l.label}
              </NavLink>
            ))}
            <div className="mt-2 flex items-center gap-6 py-3">
              <ChainTag />
              <CartLink />
              {/* phones reach the account through the page; the panel is the wide bar's
                  affordance, so the mobile row links straight there */}
              <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={itemClass(false)}>
                Profile
              </NavLink>
              <ThemeToggle />
              <NotificationBell />
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

function ChainTag() {
  const target = useTargetChain()
  const on = target?.chainId === 56
  const test = Boolean(target) && !on
  // which chain the site is settling on, said in the bar: the campaign runs on
  // mainnet and a quester needs to know it before signing anything
  return (
    <span
      title={target ? `Settling on ${chainLabel(target.chainId)} · chain ${target.chainId}` : 'Reading the chain'}
      className="inline-flex shrink-0 items-center gap-2 rounded-[8px] border border-souk-hair px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase leading-[14px] text-souk-steel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Dot tone={on ? 'good' : test ? 'sky' : 'quiet'} size={6} />
      {target ? (on ? 'Mainnet 56' : `Testnet ${target.chainId}`) : 'Reading chain'}
    </span>
  )
}

function CartLink() {
  const [count, setCount] = useState(() => cartCount())
  useEffect(() => subscribe(() => setCount(cartCount())), [])
  return (
    <Link to="/cart" aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`} className={controlClass}>
      <IconCart />
      {/* the count keeps its place as functionality, in the design's own badge chip and
          in the same corner the outbox count sits when the cart is not empty */}
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 flex h-[18px] -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-[6px] bg-souk-data px-1.5 font-mono text-[11px] font-bold leading-none text-souk-canvas"
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}

// the account panel opens under the profile chip: the design's panel holds the
// connected head, the product's destinations and the one disconnect row that never
// navigates
// the account panel shells above; the old link wrapper is retired in its favour

// the account icons the panel's rows carry, 18px line shapes at the design's strokes
function PersonGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaf2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function ClockGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaf2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function MenuCartGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaf2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h2.6l2.4 12.3a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.6L21 7H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
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
      className="flex h-[40px] items-center gap-2.5 rounded-[8px] px-2 transition-colors hover:bg-souk-surface2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Icon />
      <Stack gap={1}>
        <Txt size={13} lead={18} weight="bold" tone="ink">
          {label}
        </Txt>
        <Txt size={10} lead={14} mono tone="labels">
          {route}
        </Txt>
      </Stack>
    </Link>
  )
}

// the account panel: the same shell the outbox dropdown wears (indigo navy, one rim
// of white at 16 on every edge, a 20 radius), so the two can never drift apart
function ProfileChip({ wallet, onConnect }: { wallet: string | null; onConnect: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
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
        aria-haspopup={wallet ? 'true' : undefined}
        aria-expanded={wallet ? open : undefined}
        // a wallet nobody has picked yet connects on the spot; the account panel is
        // only an affordance once there is an account to show. the mark rides beside
        // an address, so with nothing connected the chip is the label alone
        onClick={() => (wallet ? setOpen((v) => !v) : onConnect())}
        className={wallet ? profileClass : `${profileClass} pr-4`}
      >
        {wallet ? <SoukMark size={28} /> : null}
        <Txt size={12} lead={18} mono tone="ink">
          {wallet ? shortAddress(wallet) : 'Connect Wallet'}
        </Txt>
      </button>

      {open && (
        <Stack
          bg="indigo"
          radius={20}
          hair
          pad={[14, 16, 14, 16]}
          gap={2}
          className="absolute right-0 top-full z-50 mt-2 w-[300px] shadow-lg"
        >
          <Row align="center" pad={[0, 8, 8, 8]} gap={10}>
            <SoukMark size={30} />
            <Stack gap={2}>
              <Txt size={12} lead={18} mono tone="ink">
                {wallet ? shortAddress(wallet) : 'Not connected'}
              </Txt>
              <Txt size={10} lead={14} weight="bold" upper tone="labels">
                {wallet
                  ? `Connected${target ? ` · ${chainLabel(target.chainId)}` : ''}`
                  : 'Connect to list and hire'}
              </Txt>
            </Stack>
          </Row>
          <Rule hair />
          <AccountRow label="Your profile" route="/profile" Icon={PersonGlyph} />
          <AccountRow label="Your vault" route="/vault" Icon={VaultGlyph} />
          <AccountRow label="Ongoing hires" route="/ongoing" Icon={ClockGlyph} />
          <AccountRow label="Cart" route="/cart" Icon={MenuCartGlyph} />
          <Rule hair />
          <button
            type="button"
            disabled={!wallet}
            onClick={() => {
              // forget this browser: the session, the wallet choice and the
              // record go, so a reload stays disconnected
              signOut()
              disconnectWallet()
              setOpen(false)
              window.location.reload()
            }}
            className="flex h-[40px] w-full items-center gap-2.5 rounded-[8px] px-2 text-[13px] font-bold text-souk-peach transition-colors hover:bg-souk-surface2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
          >
            {/* the one row that never navigates */}
            <PowerGlyph />
            Disconnect wallet
          </button>
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
