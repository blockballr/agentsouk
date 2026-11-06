import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentSummary } from '../core/types'
import { getAgents } from '../lib/api'
import { getShortlist, setShortlist as persistShortlist, toggleShortlist } from '../lib/shortlist'
import { Section, Stack, Row, Txt, Btn } from '../components/souk'
import { AgentGrid } from './MarketplacePage'

// The strip that used to sit under the featured card, given a page of its own.
// Same rule as the strip: admitted inside the window and answered a probe, so a
// listing with no score yet is still reachable. Newest admission first.
const WINDOW_LABEL = 'the last seven days'

const linkClass =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-souk-slate underline decoration-souk-hair underline-offset-4 hover:text-souk-ink'

export function DiscoverPage() {
  const [items, setItems] = useState<AgentSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [shortlist, setShortlist] = useState<string[]>(() => getShortlist())

  useEffect(() => {
    let cancelled = false
    setError(null)
    setItems(null)
    getAgents({ type: 'all', recent: true, metric: 'newest', limit: 48 })
      .then((result) => {
        if (!cancelled) setItems(result.items)
      })
      .catch(() => {
        if (!cancelled) setError('The shelf did not answer.')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  function handleToggle(key: string) {
    setShortlist(toggleShortlist(key))
  }

  function clearShortlist() {
    setShortlist([])
    persistShortlist([])
  }

  return (
    <Section pad="pt-10 pb-16">
      <Stack gap={28}>
        <Stack gap={10}>
          <Row align="center" gap={12} className="flex-wrap">
            <Link to="/agents" className={linkClass}>
              Agent shelf
            </Link>
            <Txt size={10} lead={14} mono upper tone="muted">
              /
            </Txt>
            <Txt size={10} lead={14} mono upper tone="muted">
              New listings
            </Txt>
          </Row>
          <h1 className="font-serif text-[34px] font-bold leading-[42px] text-souk-ink">
            Discover New Listing
          </h1>
          <Txt size={14} lead={22} tone="slate" className="max-w-2xl">
            Admitted in {WINDOW_LABEL} and each one answered its last probe. Newest first, so a
            listing with no score yet still has a place to be seen.
          </Txt>
          {shortlist.length > 0 ? (
            <Row align="center" gap={12}>
              <Txt size={11} lead={16} mono upper tone="data">
                {shortlist.length} shortlisted
              </Txt>
              <Btn kind="off" onClick={clearShortlist}>
                Clear
              </Btn>
            </Row>
          ) : null}
        </Stack>

        {error ? (
          <Stack gap={12}>
            <Txt size={13} lead={20} tone="slate">
              {error}
            </Txt>
            <Row gap={10}>
              <Btn kind="keep" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Btn>
            </Row>
          </Stack>
        ) : items === null ? (
          <Txt size={12} lead={18} mono upper tone="muted">
            Reading new listings
          </Txt>
        ) : items.length === 0 ? (
          <Stack gap={12}>
            <Txt size={13} lead={20} tone="slate">
              Nothing was admitted in {WINDOW_LABEL}. The shelf still carries every live listing.
            </Txt>
            <Row>
              <Link to="/agents" className={linkClass}>
                Back to the shelf
              </Link>
            </Row>
          </Stack>
        ) : (
          <AgentGrid items={items} shortlist={shortlist} onToggle={handleToggle} />
        )}
      </Stack>
    </Section>
  )
}
