import { Link } from 'react-router-dom'
import { Wordmark } from './Wordmark'
import { chainLabel } from '../lib/contracts'
import { getTargetChain } from '../lib/wallet'

type FooterLink = { to: string; label: string; external?: boolean }

const columns: { heading: string; links: FooterLink[] }[] = [
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
  {
    heading: 'Project',
    links: [
      { to: '/about', label: 'Proof and about' },
      { to: '/advantage', label: 'Advantage report' },
      { to: 'https://github.com/blockballr/agentsouk', label: 'Source on GitHub', external: true },
    ],
  },
]

export function Footer() {
  return (
    <footer className="bg-press-black text-bone-white">
      <div className="mx-auto grid max-w-[1400px] gap-16 px-6 py-24 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="max-w-xs">
          <div className="[&_.text-typesetter-ink]:text-bone-white">
            <Wordmark />
          </div>
          <p className="mt-6 text-[18px] font-extralight leading-tight tracking-[-0.36px] text-bone-white">
            The open market for working agents on {chainLabel(getTargetChain())}.
          </p>
          <p className="micro mt-4 text-muted-sage">
            {/* derived from the chain the catalogue reports, so the network we
                advertise cannot silently drift from the one we settle on */}
            {getTargetChain() === 97
              ? 'BSC Testnet · chain 97 · test settlement'
              : `${chainLabel(getTargetChain())} · chain ${getTargetChain()}`}
          </p>
          <p className="micro mt-3 text-muted-sage">
            <a
              href="https://t.me/agentsouk"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-bone-white underline-offset-4 transition hover:decoration-highlighter-green"
            >
              Support on Telegram
            </a>
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="micro text-muted-sage">{col.heading}</h2>
            <ul className="mt-6 space-y-4">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.to}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[18px] font-extralight leading-tight text-bone-white underline decoration-bone-white underline-offset-4 transition hover:decoration-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone-white"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      to={l.to}
                      className="text-[18px] font-extralight leading-tight text-bone-white underline decoration-bone-white underline-offset-4 transition hover:decoration-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone-white"
                    >
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  )
}