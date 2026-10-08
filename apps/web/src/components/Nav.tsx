import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Wordmark } from './Wordmark'
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

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-8">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-8">
          <ul className="hidden items-center gap-8 lg:flex">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.to === '/'}
                  className={({ isActive }) =>
                    `micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-press-black ${
                      isActive ? 'border-b border-highlighter-green' : 'border-b border-transparent'
                    }`
                  }
                >
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
          <div className="hidden lg:flex lg:items-center lg:gap-8">
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
            className="flex h-11 w-11 items-center justify-center text-press-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-press-black lg:hidden"
          >
            <MenuIcon />
          </button>
        </nav>
      </div>

      {menuOpen && (
        <div className="border-b hairline border-slate-verdant/40 bg-background lg:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-[1400px] flex-col gap-1 px-6 py-4">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `py-3 text-lg font-serif ${
                    isActive ? 'text-press-black' : 'text-newsprint-gray'
                  } focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-press-black`
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
    <Link
      to="/cart"
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
      className="micro flex h-9 items-center gap-2 rounded-[4px] border hairline border-slate-verdant/40 px-2.5 text-newsprint-gray transition-colors hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
    >
      <CartGlyph />
      {count > 0 ? <span className="tabular-nums text-press-black">{count}</span> : null}
    </Link>
  )
}

function AboutLink({ onClick }: { onClick?: () => void }) {
  return (
    <NavLink
      to="/about"
      onClick={onClick}
      className={({ isActive }) =>
        `micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-press-black ${
          isActive ? 'border-b border-highlighter-green' : 'border-b border-transparent'
        }`
      }
    >
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
        `micro flex h-9 items-center gap-2 rounded-[4px] border hairline px-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
          isActive
            ? 'border-highlighter-green text-press-black'
            : 'border-slate-verdant/40 text-newsprint-gray hover:text-press-black'
        }`
      }
    >
      <ProfileGlyph />
      Profile
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