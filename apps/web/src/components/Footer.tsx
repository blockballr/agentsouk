import { Link } from 'react-router-dom'
import { Wordmark } from './Wordmark'

const columns = [
  {
    heading: 'Market',
    links: [
      { to: '/agents', label: 'All agents' },
      { to: '/agents?category=health-factor', label: 'Health factor' },
      { to: '/agents?category=grid-trading', label: 'Grid trading' },
      { to: '/agents?category=yield', label: 'Yield' },
      { to: '/compare', label: 'Compare' },
    ],
  },
  {
    heading: 'Protocol',
    links: [
      { to: '/agents', label: 'x402 payments' },
      { to: '/agents', label: 'ERC-8004 registry' },
      { to: '/agents', label: 'BNB Smart Chain' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="bg-press-black text-bone-white">
      <div className="mx-auto grid max-w-[1400px] gap-16 px-6 py-24 md:grid-cols-[1fr_auto_auto]">
        <div className="max-w-xs">
          <div className="[&_.text-typesetter-ink]:text-bone-white">
            <Wordmark />
          </div>
          <p className="mt-6 text-[18px] font-extralight leading-tight tracking-[-0.36px] text-bone-white">
            The open market for working agents on BNB Smart Chain.
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="micro text-muted-sage">{col.heading}</h2>
            <ul className="mt-6 space-y-4">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    className="text-[18px] font-extralight leading-tight text-bone-white underline decoration-bone-white underline-offset-4 transition hover:decoration-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  )
}