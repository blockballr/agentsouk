import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSellerData } from '../lib/seller-data'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface OpenJob {
  chainId: number
  jobId: number
  provider: string
  budgetUsd: number
  stage: 'deliver' | 'awaiting_buyer'
  expiresAt: string
  submittedAt: string | null
}

function timeLeft(iso: string): string {
  const hours = Math.round((Date.parse(iso) - Date.now()) / 3_600_000)
  if (hours < 1) return 'less than an hour left'
  if (hours < 48) return `${hours} hours left`
  return `${Math.round(hours / 24)} days left`
}

// the seller's side of "waiting on you": pay-on-delivery jobs buyers funded for this wallet's agents,
// read from the chain-wide job index by the wallets the agents work from
export function JobsToDeliver() {
  const { account, owned } = useSellerData()
  const [jobs, setJobs] = useState<OpenJob[] | null>(null)

  const agents = owned?.agents ?? []
  const providers = [...new Set([account, ...agents.map((a) => a.agentWallet)].filter((w): w is string => Boolean(w)).map((w) => w.toLowerCase()))]
  const key = providers.join(',')

  useEffect(() => {
    setJobs(null)
    if (!key) return
    let alive = true
    fetch(`${API_BASE}/jobs8183/to-deliver?providers=${key}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { jobs?: OpenJob[] } | null) => {
        if (alive) setJobs(body?.jobs ?? [])
      })
      .catch(() => {
        if (alive) setJobs([])
      })
    return () => {
      alive = false
    }
  }, [key])

  if (!account || !jobs || jobs.length === 0) return null

  const nameFor = (provider: string) => agents.find((a) => a.agentWallet?.toLowerCase() === provider.toLowerCase())
  return (
    <section aria-label="Jobs to deliver" className="mb-8 grid gap-3">
      <h2 className="m-0 text-[18px] font-semibold text-souk-ink">Jobs to deliver</h2>
      <p className="m-0 text-[13px] leading-[19px] text-souk-steel">
        Buyers funded these. The payment sits in escrow and reaches you when the buyer accepts the work; a job that runs out of
        time goes back to the buyer.
      </p>
      <ul className="divide-y divide-souk-hair rounded-[14px] border border-souk-data/40">
        {jobs.map((j) => {
          const agent = nameFor(j.provider)
          return (
            <li key={`${j.chainId}-${j.jobId}`} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-souk-ink">
                  {agent ? agent.name : 'Your agent'}, job {j.jobId}
                </span>
                <span className="block text-[12.5px] leading-[18px] text-souk-steel">
                  {j.stage === 'deliver' ? 'Funded: your agent needs to deliver the work' : 'Delivered: waiting for the buyer to accept'}
                  {', '}
                  {timeLeft(j.expiresAt)}
                </span>
              </span>
              <span className="flex items-baseline gap-4">
                <span className="font-mono text-[13px] text-souk-ink">${j.budgetUsd.toFixed(2)}</span>
                {agent ? (
                  <Link to={`/agents/${agent.chainId}/${agent.tokenId}`} className="text-[12px] text-souk-sky hover:underline">
                    Open agent
                  </Link>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
