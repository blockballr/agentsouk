import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Txt } from './souk'
import { formatCompact } from '../lib/earnings'

const FLUX_URL = 'https://fluxlp.agentsouk.xyz'
const FLUX_LISTING = '/agents/56/406220'

interface PoolRow {
  symbol: string
  venue: string | null
  tvlUsd: number
  fees24hUsd: number
  feeTvlDay: number
}

interface FluxSummary {
  pools: number
  tvlUsd: number
  fees24hUsd: number
  ranked: PoolRow[]
}

const pct = (share: number) => `${(share * 100).toFixed(2)}%`
const VENUE: Record<string, string> = { pancake: 'PancakeSwap V3', uniswap: 'Uniswap V3' }

// the lead: Flux LP, and the stock pools it works, read live. the figures are
// the pools' own, never Flux LP's results, and the section says so
export function FluxLeadSection() {
  const [summary, setSummary] = useState<FluxSummary | null>(null)
  const [picked, setPicked] = useState(0)

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL ?? '/api'
    let alive = true
    fetch(`${base}/flux/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (alive && body?.success && Array.isArray(body.ranked)) setSummary(body as FluxSummary)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const pools = summary?.ranked.slice(0, 6) ?? []
  const best = pools[0]?.feeTvlDay ?? 0
  const pool = pools[picked] ?? null

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div>
        <p className="font-mono text-[11px] uppercase leading-[16px] tracking-[0.08em] text-souk-data">Flux LP</p>
        <h2 className="mt-3 font-serif text-[clamp(30px,3.4vw,52px)] font-bold leading-[1.05] tracking-[-0.03em] text-souk-ink">
          Stock liquidity that keeps market hours.
        </h2>
        <Txt size={16} lead={25} tone="slate" className="mt-5 block max-w-[46ch]">
          Open a position in a tokenized stock pool. Flux LP works it: it collects the fees, widens the range or
          exits as the US session moves.
        </Txt>
        <Txt size={13} lead={20} tone="steel" className="mt-3 block max-w-[46ch]">
          You keep the position. Flux LP can only take liquidity out, collect fees or widen the range, under caps and a kill switch.
        </Txt>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <a href={FLUX_URL}>
            <Btn kind="primary">Open Flux LP</Btn>
          </a>
          <Link to={FLUX_LISTING}>
            <Btn>Its listing</Btn>
          </Link>
        </div>
      </div>

      {summary && pools.length > 0 ? (
        <div className="rounded-[16px] border border-souk-hair bg-souk-surface1 p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">
              Fees paid per dollar, last 24h
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">
              {summary.pools} pools, ${formatCompact(summary.tvlUsd)}
            </span>
          </div>

          <ul className="mt-3 flex flex-col gap-1" role="listbox" aria-label="Stock pools">
            {pools.map((row, i) => {
              const on = i === picked
              return (
                <li key={row.symbol + (row.venue ?? '') + i}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => setPicked(i)}
                    onMouseEnter={() => setPicked(i)}
                    className={`grid w-full grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 rounded-[8px] px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data ${
                      on ? 'bg-souk-surface2' : 'hover:bg-souk-surface2/60'
                    }`}
                  >
                    <span className="truncate font-mono text-[12px] text-souk-ink">
                      {row.symbol.replace('/USDT', '')}
                      {row.venue ? (
                        <span className="ml-1.5 text-[10px] uppercase text-souk-labels">
                          {row.venue === 'pancake' ? 'pcs' : row.venue === 'uniswap' ? 'uni' : row.venue}
                        </span>
                      ) : null}
                    </span>
                    <span className="h-[6px] rounded-full bg-souk-hair/40">
                      <span
                        className={`block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${on ? 'bg-souk-data' : 'bg-souk-data/45'}`}
                        style={{ width: `${Math.max(4, (row.feeTvlDay / best) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-[12px] text-souk-ink">{pct(row.feeTvlDay)}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          {pool ? (
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-souk-hair pt-4">
              <div className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">Liquidity</dt>
                <dd className="mt-1 font-mono text-[20px] font-bold text-souk-data">${formatCompact(pool.tvlUsd)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">Fees, 24h</dt>
                <dd className="mt-1 font-mono text-[20px] font-bold text-souk-data">${formatCompact(pool.fees24hUsd)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">Venue</dt>
                <dd className="mt-1 truncate text-[13px] leading-[28px] text-souk-ink">
                  {pool.venue ? VENUE[pool.venue] ?? pool.venue : 'Unknown'}
                </dd>
              </div>
            </dl>
          ) : null}

          <Txt size={11} lead={16} tone="steel" className="mt-3 block">
            The pools' own figures, read live, shared by everyone providing liquidity. Not Flux LP's results, and a stock move can outweigh a day of fees.
          </Txt>
        </div>
      ) : null}
    </div>
  )
}
