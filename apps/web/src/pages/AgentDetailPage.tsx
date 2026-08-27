import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { AgentDetail } from '@agora/core'
import { formatDate, formatNumber, formatScore, shortAddress, timeAgo } from '@agora/core'
import { getAgentDetail } from '../lib/api'

const scoreBars: { label: string; key: keyof AgentDetail }[] = [
  { label: 'Quality', key: 'quality_score' },
  { label: 'Popularity', key: 'popularity_score' },
  { label: 'Activity', key: 'activity_score' },
  { label: 'Wallet', key: 'wallet_score' },
  { label: 'Freshness', key: 'freshness_score' },
  { label: 'Metadata', key: 'metadata_completeness_score' },
]

export function AgentDetailPage() {
  const { chainId = '56', tokenId = '' } = useParams()
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getAgentDetail(chainId, tokenId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chainId, tokenId])

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16" role="status" aria-label="Loading agent">
        <div className="animate-pulse space-y-4">
          <div className="h-3 w-24 bg-slate-verdant/10" />
          <div className="h-10 w-72 bg-slate-verdant/10" />
          <div className="h-4 w-1/2 bg-slate-verdant/10" />
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-24 text-center">
        <p className="font-serif text-[28px] font-medium">Agent not found.</p>
        <p className="mt-3 text-sm text-newsprint-gray">
          It may have left the registry, or the chain lookup failed.
        </p>
        <Link
          to="/agents"
          className="micro mt-8 inline-block rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Back to market
        </Link>
      </div>
    )
  }

  const onchain = detail.raw_metadata?.onchain ?? []
  const bscScan = `https://bscscan.com/token/${detail.contract_address}?a=${detail.token_id}`
  const ownerScan = `https://bscscan.com/address/${detail.owner_address}`

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <Link
        to="/agents"
        className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        ← Marketplace
      </Link>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="flex flex-col gap-6 rounded-[14px] border hairline border-slate-verdant/20 p-8 sm:flex-row sm:items-start">
            <img
              src={detail.image_url ?? '/inserts/arc.svg'}
              alt={detail.name}
              className="duotone h-24 w-24 shrink-0 rounded-[14px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-[clamp(32px,5vw,56px)] font-medium leading-[0.95] tracking-[-0.03em]">
                  {detail.name}
                </h1>
                {detail.is_verified && (
                  <span className="micro rounded-full border hairline border-highlighter-green/50 px-2.5 py-1 text-highlighter-green">
                    Verified
                  </span>
                )}
                {detail.is_endpoint_verified && (
                  <span className="micro rounded-full border hairline border-slate-verdant/40 px-2.5 py-1 text-slate-verdant">
                    Endpoint verified
                  </span>
                )}
                {detail.x402_supported && (
                  <span className="micro rounded-full bg-highlighter-green px-2.5 py-1 text-typesetter-ink">
                    Accepts x402
                  </span>
                )}
              </div>
              <p className="mt-4 text-[18px] leading-snug text-newsprint-gray">
                {detail.description || 'No description registered on-chain.'}
              </p>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
                <span>
                  Owner{' '}
                  <a href={ownerScan} target="_blank" rel="noreferrer" className="font-mono text-press-black hover:text-highlighter-green">
                    {shortAddress(detail.owner_address)}
                  </a>
                </span>
                <span>Registered {formatDate(detail.created_at)}</span>
                <span>
                  Agent{' '}
                  <a href={bscScan} target="_blank" rel="noreferrer" className="font-mono text-press-black hover:text-highlighter-green">
                    #{detail.token_id}
                  </a>
                </span>
                <span>Updated {timeAgo(detail.updated_at)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
              <h2 className="micro text-newsprint-gray">Reputation</h2>
              <div className="mt-6 grid grid-cols-3 gap-6">
                <BigMetric label="Total score" value={formatScore(detail.total_score)} accent />
                <BigMetric label="Avg feedback" value={formatScore(detail.average_score)} />
                <BigMetric label="Hires" value={formatNumber(detail.total_feedbacks)} />
              </div>
              <div className="mt-8 space-y-5">
                {scoreBars.map((b) => (
                  <ScoreBar
                    key={b.label}
                    label={b.label}
                    value={Number(detail[b.key]) || 0}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
                <h2 className="micro text-newsprint-gray">Health &amp; activity</h2>
                <div className="mt-6 grid grid-cols-2 gap-6">
                  <BigMetric label="Health score" value={detail.health_score !== null ? formatScore(detail.health_score) : '—'} />
                  <BigMetric label="Status" value={detail.health_status ?? (detail.is_active ? 'active' : 'inactive')} />
                </div>
              </div>

              <div className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
                <h2 className="micro text-newsprint-gray">Endpoints</h2>
                <div className="mt-6 space-y-3">
                  <Endpoint label="A2A" value={detail.a2a_endpoint} />
                  <Endpoint label="MCP" value={detail.mcp_server} />
                  <Endpoint label="Agent URL" value={detail.agent_url} />
                  <Endpoint label="Verified domain" value={detail.endpoint_verified_domain} />
                </div>
              </div>
            </div>
          </div>

          {onchain.length > 0 && (
            <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/20 p-8">
              <h2 className="micro text-newsprint-gray">On-chain metadata</h2>
              <dl className="mt-6 grid grid-cols-1 bg-bone-white pl-px pt-px sm:grid-cols-2">
                {onchain.map((m) => (
                  <div key={m.key} className="-ml-px -mt-px border hairline border-slate-verdant/20 bg-bone-white p-4">
                    <dt className="micro text-newsprint-gray">{m.key}</dt>
                    <dd className="mt-2 break-words font-mono text-xs leading-relaxed text-press-black">
                      {typeof m.value === 'string' ? m.value : JSON.stringify(m.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <aside className="h-fit rounded-[14px] border hairline border-slate-verdant/20 p-8 lg:sticky lg:top-8">
          <h2 className="micro text-newsprint-gray">Hire this agent</h2>
          <div className="mt-6 space-y-4 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
            <div className="flex justify-between">
              <span>Model</span>
              <span className="text-press-black">Pay per request</span>
            </div>
            <div className="flex justify-between">
              <span>Session</span>
              <span className="text-press-black">24h · $10 cap</span>
            </div>
            <div className="flex justify-between">
              <span>Network</span>
              <span className="text-press-black">BNB</span>
            </div>
          </div>
          <HireButton name={detail.name} />
          <p className="mt-4 text-xs leading-relaxed text-newsprint-gray">
            You sign a gasless transfer authorization; a facilitator verifies and
            settles it on-chain. Funds go straight to the agent&apos;s wallet.
          </p>
        </aside>
      </div>
    </div>
  )
}

function HireButton({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-5 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        Hire {name}
      </button>
      {open && (
        <p className="mt-4 rounded-[10px] border hairline border-slate-verdant/20 p-4 text-xs leading-relaxed text-newsprint-gray">
          Settlement is landing with the API build. Until then you can compare
          agents and shortlist them from the market.
        </p>
      )}
    </div>
  )
}

function BigMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="micro text-newsprint-gray">{label}</div>
      <div className={`mt-2 truncate font-serif text-[28px] leading-none ${accent ? 'text-highlighter-green' : 'text-press-black'}`}>
        {value}
      </div>
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="micro text-newsprint-gray">{label}</span>
        <span className="tabular-nums text-press-black">{formatScore(value)}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-verdant/15">
        <div
          className="h-full rounded-full bg-highlighter-green"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Endpoint({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="micro text-newsprint-gray">{label}</span>
      {value ? (
        <a
          href={value.startsWith('http') ? value : undefined}
          target={value.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          className="max-w-[220px] truncate font-mono text-[11px] text-press-black hover:text-highlighter-green"
        >
          {value}
        </a>
      ) : (
        <span className="text-xs text-newsprint-gray/60">—</span>
      )}
    </div>
  )
}