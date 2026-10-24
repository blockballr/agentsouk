import { Link } from 'react-router-dom'
import { chainLabel } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { Label, Row, Stack, Txt } from './souk'
import { Wordmark } from './Wordmark'
import { useI18n } from '../lib/i18n'

// No external flag. The columns that used to carry one were re-pointed at internal routes
// when the about link was dropped, which left the anchor branch unreachable, so it was
// removed rather than left as a second way to render a link nobody uses.
type FooterLink = { to: string; label: string }

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: 'footer.market',
    links: [
      { to: '/agents', label: 'footer.allAgents' },
      { to: '/agents?category=rebalancing', label: 'footer.rebalancing' },
      { to: '/agents?category=health-factor', label: 'footer.healthFactor' },
      { to: '/agents?category=grid-trading', label: 'footer.gridTrading' },
      { to: '/agents?category=yield', label: 'footer.yield' },
      { to: '/compare', label: 'footer.compare' },
    ],
  },
  {
    heading: 'footer.protocol',
    links: [
      { to: '/agents', label: 'footer.x402' },
      { to: '/agents', label: 'footer.registry' },
      { to: '/agents', label: 'footer.chain' },
    ],
  },
  {
    heading: 'footer.project',
    links: [
      { to: '/about', label: 'footer.about' },
      { to: '/quest', label: 'footer.passport' },
      { to: '/advantage', label: 'footer.advantage' },
      { to: '/profile', label: 'footer.listings' },
    ],
  },
]

export function Footer() {
  const { t } = useI18n()
  const target = useTargetChain()
  return (
    <footer className="border-t border-souk-edge bg-souk-canvas">
      <div className="w-full pb-16 pt-8">
        <Stack gap={20}>
          <div className="flex flex-col gap-[60px] lg:flex-row">
            <Stack gap={8} className="max-w-[420px]">
              <Wordmark />
              <Txt size={15} lead={22} tone="slate">
                {t('footer.tagline')}{target ? ` on ${chainLabel(target.chainId)}` : ''}.
              </Txt>
              <Txt size={11} lead={16} mono tone="labels">
                {/* derived from the chain the server reports, so the network we
                    advertise cannot silently drift from the one we settle on */}
                {target
                  ? target.chainId === 97
                    ? `${chainLabel(target.chainId)} · chain ${target.chainId} · test settlement`
                    : `${chainLabel(target.chainId)} · chain ${target.chainId}`
                  : t('footer.checking')}
              </Txt>
              {target?.chainId === 97 && (
                <Txt size={11} lead={16} mono tone="labels">
                  This is the chain 97 test deployment; the live market settles on
                  chain 56.
                </Txt>
              )}
              <Row justify="between" align="center">
                <a
                  href="https://t.me/agentsouk"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] leading-[18px] text-souk-sky transition hover:text-souk-ink"
                >
                  {t('footer.telegram')}
                </a>
                <Txt size={11} lead={16} mono tone="labels">
                  t.me/agentsouk
                </Txt>
              </Row>
            </Stack>
            {columns.map((col) => (
              <nav key={col.heading} aria-label={t(col.heading)} className="w-full min-w-0 lg:flex-1">
                <Stack gap={9}>
                  <Label tone="muted">{t(col.heading)}</Label>
                  {col.links.map((l) => (
                    <Link
                      key={l.label}
                      to={l.to}
                      className="text-[14px] leading-[20px] text-souk-slate transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data"
                    >
                      {t(l.label)}
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
