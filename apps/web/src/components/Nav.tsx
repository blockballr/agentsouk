import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { shortAddress } from '@agora/core'
import { QuickSearch } from './QuickSearch'
import { NotificationBell } from './NotificationBell'
import { cartCount, subscribe } from '../lib/cart'
import { getActiveAccount } from '../lib/wallet'
import { IconCart, LogoMark, Txt } from './souk'

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

// the bar's control squares: the design's 38 tall, an 8 radius, one 16% rim, the rim
// taking the hover since the icons carry their own colour rather than inheriting it
const controlClass =
  'relative flex h-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] border border-white/[0.16] text-souk-steel transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data hover:border-souk-data/50'

// the profile chip: wider than a square, because the design puts the mark and the
// connected address in it rather than an icon alone
const profileClass =
  'flex h-[38px] shrink-0 items-center gap-2 rounded-[8px] border border-white/[0.16] pl-2.5 pr-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data hover:border-souk-data/50'

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  // the profile chip says the wallet rather than spelling out Profile: the address
  // is the affordance, so the connected account is read once here and passed down
  const [wallet, setWallet] = useState<string | null>(null)
  useEffect(() => {
    void getActiveAccount().then(setWallet)
  }, [])
  return (
    <header className="relative z-10 border-b border-white/[0.16] bg-souk-canvas">
      <div className="mx-auto flex h-[62px] max-w-[1920px] items-center justify-between px-8">
        {/* left: the wordmark and the section links, the design's first cluster */}
        <div className="flex items-center gap-[44px]">
          <Link
            to="/"
            className="font-mono text-[13px] font-bold uppercase leading-[16px] text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data"
          >
            Agent Souk
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => itemClass(isActive)}>
                {l.label}
              </NavLink>
            ))}
            {/* the plain text links belong in this one row: a group that also holds
                the boxed controls is taller, so its text centres against a different
                box height and the row reads misaligned */}
            <AboutLink />
          </nav>
        </div>

        {/* right: the controls. The design draws them as the bar's second cluster, so
            they are a sibling of the wordmark group and the space between pins them to
            the far edge rather than to the end of the links */}
        <div className="hidden lg:flex lg:items-center lg:gap-2.5">
          <QuickSearch />
          <NotificationBell />
          <CartLink />
          <ProfileLink wallet={wallet} />
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
        <div className="border-b border-white/[0.16] bg-souk-canvas lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-[1920px] flex-col gap-1 px-8 py-4">
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
              <AboutLink onClick={() => setMenuOpen(false)} />
              <CartLink />
              <ProfileLink onClick={() => setMenuOpen(false)} wallet={wallet} />
              <NotificationBell />
            </div>
          </nav>
        </div>
      )}
    </header>
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

function AboutLink({ onClick }: { onClick?: () => void }) {
  return (
    <NavLink to="/about" onClick={onClick} className={({ isActive }) => itemClass(isActive)}>
      About
    </NavLink>
  )
}

function ProfileLink({ onClick, wallet }: { onClick?: () => void; wallet: string | null }) {
  return (
    <NavLink
      to="/profile"
      onClick={onClick}
      aria-label="Profile, your listings"
      className={({ isActive }) => `${profileClass} ${isActive ? 'border-souk-data/60' : ''}`}
    >
      {/* the wallet says it: the design shows the connected address rather than the
          word Profile, so an unconnected chip falls back to the noun alone */}
      <LogoMark size={28} />
      <Txt size={12} lead={18} mono tone="ink">
        {wallet ? shortAddress(wallet) : 'Profile'}
      </Txt>
    </NavLink>
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
