import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { QuickSearch } from './QuickSearch'
import { NotificationBell } from './NotificationBell'
import { cartCount, subscribe } from '../lib/cart'

const links = [
  { to: '/agents', label: 'Marketplace' },
  { to: '/compare', label: 'Compare' },
  { to: '/ongoing', label: 'Ongoing' },
  { to: '/list', label: 'List agent' },
]

// the design's top bar item: upper case, and the active one is the only ink in the
// row with a rule under it. Steel is the resting tone so the current page reads at a
// glance rather than every item competing.
const itemClass = (isActive: boolean): string =>
  `border-b-2 text-[13px] uppercase leading-[18px] transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data ${
    isActive
      ? 'border-souk-data font-semibold text-souk-ink'
      : 'border-transparent text-souk-steel hover:text-souk-ink'
  }`

// the 38 square control the design puts in the bar's right cluster
const controlClass =
  'flex h-[38px] items-center justify-center gap-2 rounded-[8px] border border-white/[0.16] px-2.5 text-souk-steel transition-colors hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data'

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="relative z-10 border-b border-white/[0.16] bg-souk-canvas">
      <div className="mx-auto flex h-[62px] max-w-[1920px] items-center justify-between px-8">
        <div className="flex items-center gap-[44px]">
          <Link
            to="/"
            className="font-mono text-[13px] font-bold uppercase leading-[16px] text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data"
          >
            Agent Souk
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-7">
            <ul className="hidden items-center gap-7 lg:flex">
              {links.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} end={l.to === '/'} className={({ isActive }) => itemClass(isActive)}>
                    {l.label}
                  </NavLink>
                </li>
              ))}
              {/* the plain text links belong in this one row: a group that also holds
                  the boxed controls is taller, so its text centres against a different
                  box height and the row reads misaligned */}
              <li>
                <AboutLink />
              </li>
            </ul>
            <div className="hidden lg:flex lg:items-center lg:gap-2.5">
              <QuickSearch />
              <NotificationBell />
              <CartLink />
              <ProfileLink />
              <ThemeToggle />
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
          </nav>
        </div>
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
              <ProfileLink onClick={() => setMenuOpen(false)} />
              <NotificationBell />
              <ThemeToggle />
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
      <CartGlyph />
      {count > 0 ? <span className="font-mono tabular-nums text-souk-ink">{count}</span> : null}
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

function ProfileLink({ onClick }: { onClick?: () => void }) {
  return (
    <NavLink
      to="/profile"
      onClick={onClick}
      aria-label="Profile, your listings"
      className={({ isActive }) =>
        `${controlClass} ${
          isActive ? 'border-souk-data/60 text-souk-ink' : ''
        }`
      }
    >
      <ProfileGlyph />
      <span className="text-[13px] uppercase">Profile</span>
    </NavLink>
  )
}

function ProfileGlyph() {
  return (
    <svg width="14" height="15" viewBox="0 0 14 15" fill="none" aria-hidden="true">
      <circle cx="7" cy="4.3" r="3.1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M1.5 14c0-2.9 2.4-4.7 5.5-4.7s5.5 1.8 5.5 4.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CartGlyph() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <path
        d="M1 1h2l1.6 8.1a1.5 1.5 0 0 0 1.48 1.24h6.16a1.5 1.5 0 0 0 1.47-1.19L15 4H4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.2" cy="12.8" r="1.1" fill="currentColor" />
      <circle cx="12.2" cy="12.8" r="1.1" fill="currentColor" />
    </svg>
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
