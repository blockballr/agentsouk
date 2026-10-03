import { Link } from 'react-router-dom'
import { Wordmark } from './Wordmark'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'

// No external flag. The columns that used to carry one were re-pointed at internal routes
// when the about link was dropped, which left the anchor branch unreachable, so it was
// removed rather than left as a second way to render a link nobody uses.
type FooterLink = { to: string; label: string }

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: 'Market',
    links: [
      { to: '/agents', label: 'All agents' },
      { to: '/agents?category=rebalancing', label: 'Rebalancing' },
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
      { to: '/about', label: 'About' },
      { to: '/quest', label: 'Souk passport' },
      { to: '/advantage', label: 'Advantage report' },
      { to: '/profile', label: 'Your listings' },
    ],
  },
]

export function Footer() {
  const target = useTargetChain()
  return (
    <footer className="bg-press-black text-bone-white">
      <div className="mx-auto grid max-w-[1400px] gap-16 px-6 py-24 md:grid-cols-[1fr_auto_auto_auto]">
        <div className="max-w-xs">
          <div className="[&_.text-typesetter-ink]:text-bone-white">
            <Wordmark />
          </div>
          <p className="mt-6 text-[18px] font-extralight leading-tight tracking-[-0.36px] text-bone-white">
            The open market for working agents{target ? ` on ${chainLabel(target.chainId)}` : ''}.
          </p>
          <p className="micro mt-4 text-muted-sage">
            {/* derived from the chain the server reports, so the network we
                advertise cannot silently drift from the one we settle on */}
            {target
              ? target.chainId === 97
                ? `${chainLabel(target.chainId)} · chain ${target.chainId} · test settlement`
                : `${chainLabel(target.chainId)} · chain ${target.chainId}`
              : 'Checking the network'}
          </p>
          {target?.chainId === 97 && (
            <p className="micro mt-3 text-muted-sage">
              Mainnet cutover to chain 56 is planned; settlement stays on testnet
              for this phase.
            </p>
          )}
          <p className="micro mt-3 text-muted-sage">
            <a
              href="https://t.me/agentsouk"
              target="_blank"
              rel="noreferrer"
              className="inline-block py-3 underline decoration-highlighter-green text-highlighter-green underline-offset-4 transition hover:decoration-bone-white sm:py-0"
            >
              Agent Souk support on Telegram
            </a>
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="micro text-muted-sage">{col.heading}</h2>
            <ul className="mt-4 space-y-1">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    className="inline-block py-2 text-[18px] font-extralight leading-tight text-bone-white underline decoration-bone-white underline-offset-4 transition hover:decoration-highlighter-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone-white"
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