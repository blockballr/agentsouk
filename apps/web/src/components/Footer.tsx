import { Link } from 'react-router-dom'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { Label, Row, Stack, Txt } from './souk'
import { Wordmark } from './Wordmark'

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
    <footer className="border-t border-souk-edge bg-souk-canvas">
      <div className="px-4 lg:px-8 pb-16 pt-8">
        <Stack gap={20}>
          <div className="flex flex-col gap-[60px] lg:flex-row">
            <Stack gap={8} className="max-w-[420px]">
              <Wordmark />
              <Txt size={15} lead={22} tone="slate">
                The open market for working agents{target ? ` on ${chainLabel(target.chainId)}` : ''}.
              </Txt>
              <Txt size={11} lead={16} mono tone="labels">
                {/* derived from the chain the server reports, so the network we
                    advertise cannot silently drift from the one we settle on */}
                {target
                  ? target.chainId === 97
                    ? `${chainLabel(target.chainId)} · chain ${target.chainId} · test settlement`
                    : `${chainLabel(target.chainId)} · chain ${target.chainId}`
                  : 'Checking the network'}
              </Txt>
              {target?.chainId === 97 && (
                <Txt size={11} lead={16} mono tone="labels">
                  Mainnet cutover to chain 56 is planned; settlement stays on testnet
                  for this phase.
                </Txt>
              )}
              <Row justify="between" align="center">
                <a
                  href="https://t.me/agentsouk"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] leading-[18px] text-souk-sky transition hover:text-souk-ink"
                >
                  Agent Souk support on Telegram
                </a>
                <Txt size={11} lead={16} mono tone="labels">
                  t.me/agentsouk
                </Txt>
              </Row>
            </Stack>
            {columns.map((col) => (
              <nav key={col.heading} aria-label={col.heading} className="w-full lg:w-[418px]">
                <Stack gap={9}>
                  <Label tone="muted">{col.heading}</Label>
                  {col.links.map((l) => (
                    <Link
                      key={l.label}
                      to={l.to}
                      className="text-[14px] leading-[20px] text-souk-slate transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data"
                    >
                      {l.label}
                    </Link>
                  ))}
                </Stack>
              </nav>
            ))}
          </div>
        </Stack>
      </div>
    </footer>
  )
}
