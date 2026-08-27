import { Link, NavLink } from 'react-router-dom'
import { Wordmark } from './Wordmark'

const links = [
  { to: '/agents', label: 'Marketplace' },
  { to: '/compare', label: 'Compare' },
]

export function Nav() {
  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-8">
        <Wordmark />
        <nav aria-label="Primary" className="flex items-center gap-8">
          <ul className="flex items-center gap-8">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
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
          </ul>
          <Link
            to="/agents"
            aria-label="Open the market"
            className="flex h-10 w-10 items-center justify-center text-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-press-black"
          >
            <MenuIcon />
          </Link>
        </nav>
      </div>
    </header>
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