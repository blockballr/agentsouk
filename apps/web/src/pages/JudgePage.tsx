import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStatus, type StatusJob } from '../lib/api'
import { Stack, Row, Txt, Btn, Rule } from '../components/souk'

const CHECKS: Array<{ asks: string; how: string; href: string; external?: boolean }> = [
  {
    asks: 'Live on your own domain, public, no login to browse',
    how: 'Open the shelf',
    href: '/agents',
  },
  {
    asks: 'Network stated on the site',
    how: 'Chain 56 in the shelf header',
    href: '/agents',
  },
  {
    asks: 'Agents read from ERC-8004 with registry ID and freshness',
    how: 'Open a listing and its registry record',
    href: '/agents/56/376593',
  },
  {
    asks: 'All four categories, at least three agents each',
    how: 'Counts by category',
    href: '/api/agents?limit=1',
    external: true,
  },
  {
    asks: 'A working hire with scoped approval, cap and revoke',
    how: 'Start a hire on any card',
    href: '/agents',
  },
  {
    asks: 'Tracking: addresses, events, IDs, API, team wallets',
    how: 'The tracking document',
    href: 'https://github.com/blockballr/agentsouk/blob/main/docs/tracking-submission.md',
    external: true,
  },
  {
    asks: 'Public repository with a live URL and setup',
    how: 'Repository',
    href: 'https://github.com/blockballr/agentsouk',
    external: true,
  },
]

export function JudgePage() {
  const [jobs, setJobs] = useState<StatusJob[] | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    getStatus()
      .then((r) => {
        if (cancelled) return
        setJobs(r.data.jobs)
        setChainId(r.data.chainId)
      })
      .catch(() => {
        if (cancelled) return
        setFailed(true)
        setJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const catalogue = jobs?.[0] ?? null

  return (
    <Stack gap={28} className="mx-auto w-full max-w-[1100px] px-6 py-12">
      <Stack gap={10}>
        <Txt size={11} weight="bold" upper tone="muted">
          For reviewers
        </Txt>
        <Txt size={40} lead={46} weight="bold" tone="ink" className="font-serif">
          Judge path.
        </Txt>
        <Txt size={15} lead={24} tone="slate" className="max-w-[720px]">
          One page. Every line of the brief, with the live check next to it. No wallet
          is needed to browse.
        </Txt>
      </Stack>

      <Rule />

      <Stack gap={0} className="border border-souk-hair">
        {CHECKS.map((c, i) => (
          <Row
            key={c.asks}
            justify="between"
            align="center"
            gap={24}
            className={`px-5 py-4 ${i ? 'border-t border-souk-hair' : ''}`}
          >
            <Txt size={14} lead={21} tone="ink" className="max-w-[560px]">
              {c.asks}
            </Txt>
            {c.external ? (
              <a href={c.href} target="_blank" rel="noreferrer" className="shrink-0">
                <Btn kind="off">{c.how}</Btn>
              </a>
            ) : (
              <Link to={c.href} className="shrink-0">
                <Btn kind="off">{c.how}</Btn>
              </Link>
            )}
          </Row>
        ))}
      </Stack>

      <Stack gap={10} className="border border-souk-hair p-5">
        <Txt size={11} weight="bold" upper tone="muted">
          Marketplace MCP
        </Txt>
        <Txt size={13} lead={21} tone="slate" className="max-w-[720px]">
          Any assistant can read the shelf, open a card and list hires over JSON-RPC.
          Tools: list_agents, get_agent, list_hires, start_hire.
        </Txt>
        <Txt size={12} tone="ink" className="font-mono">
          POST https://api.agentsouk.xyz/api/mcp
        </Txt>
      </Stack>

      <Stack gap={10} className="border border-souk-hair bg-souk-surface1 p-5">
        <Txt size={11} weight="bold" upper tone="muted">
          Live catalogue
        </Txt>
        {catalogue ? (
          <Row gap={28} className="flex-wrap">
            <Txt size={13} tone="ink">
              chain {chainId ?? '-'}
            </Txt>
            <Txt size={13} tone="ink">
              block {catalogue.block ?? '-'}
            </Txt>
            <Txt size={13} tone="ink">
              shelf {catalogue.shelfSize ?? '-'}
            </Txt>
            <Txt size={13} tone="ink">
              registry {catalogue.registryTotal ?? '-'}
            </Txt>
            <Txt size={13} tone="muted">
              {catalogue.freshness.state}
              {catalogue.freshness.ageMs !== null
                ? ` ${Math.round(catalogue.freshness.ageMs / 1000)}s ago`
                : ''}
            </Txt>
          </Row>
        ) : failed ? (
          <Txt size={13} tone="slate">
            Status unavailable. The API did not answer, so the live figures cannot be attested right now.
          </Txt>
        ) : (
          <Txt size={13} tone="muted">
            Reading /api/status
          </Txt>
        )}
      </Stack>
    </Stack>
  )
}
