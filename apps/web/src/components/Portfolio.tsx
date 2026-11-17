import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPublicClient, fallback, formatUnits, http } from 'viem'
import { bsc } from 'viem/chains'
import { webRpcUrls } from '../lib/wallet'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'
const CHAINS = [56, 97] as const

interface VaultPosition {
  id: string
  agent: string
  open: boolean
  deposit: number
  value: number | null
  pnl: number | null
  realized: number | null
  expiry: number
}

interface Row extends VaultPosition {
  chainId: number
  agentName: string | null
  trades: number | null
}

function usd(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function signed(n: number): string {
  return (n >= 0 ? '+' : '-') + usd(n)
}

function endsIn(expiry: number): string {
  const days = Math.round((expiry * 1000 - Date.now()) / 86_400_000)
  if (days < 0) return 'past its end date'
  if (days === 0) return 'ends today'
  return `ends in ${days} day${days === 1 ? '' : 's'}`
}

async function readChain(buyer: string, chainId: number): Promise<Row[]> {
  const [positionsRes, agentsRes] = await Promise.all([
    fetch(`${API_BASE}/vault/positions?buyer=${buyer}&chainId=${chainId}`),
    fetch(`${API_BASE}/vault/agents?chain=${chainId}`),
  ])
  if (!positionsRes.ok) return []
  const positions = ((await positionsRes.json().catch(() => null)) as { positions?: VaultPosition[] } | null)?.positions ?? []
  const agents = agentsRes.ok
    ? (((await agentsRes.json().catch(() => null)) as { agents?: { wallet: string; name: string }[] } | null)?.agents ?? [])
    : []
  return Promise.all(
    positions.map(async (p) => {
      let trades: number | null = null
      try {
        const res = await fetch(`${API_BASE}/vault/receipts?chainId=${chainId}&hireId=${p.id}`)
        const receipts = ((await res.json()) as { receipts?: { status: string }[] }).receipts ?? []
        trades = receipts.filter((r) => r.status === 'traded').length
      } catch {
        // the count is left out rather than shown as zero
      }
      const name = agents.find((a) => a.wallet.toLowerCase() === p.agent.toLowerCase())?.name ?? null
      return { ...p, chainId, agentName: name, trades }
    }),
  )
}

// the guard's limits and prepaid fee, read from its two contracts for any wallet
const GUARD_OPERATOR = '0xb63cd6dbe6a48761190f4d3a819b0485c43221d6' as const
const GUARD_SUBSCRIPTION = '0x14ca53f7b4edfc9b0f49d6fe25532339c7ec5877' as const
const GUARD_ABI = [
  {
    name: 'mandateOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'buyer', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'asset', type: 'address' },
          { name: 'triggerBps', type: 'uint32' },
          { name: 'targetBps', type: 'uint32' },
          { name: 'maxRepayPerCall', type: 'uint128' },
          { name: 'maxRepayPerDay', type: 'uint128' },
          { name: 'expiry', type: 'uint64' },
          { name: 'active', type: 'bool' },
          { name: 'positions', type: 'tuple[]', components: [{ name: 'account', type: 'address' }, { name: 'vTokenDebt', type: 'address' }] },
        ],
      },
    ],
  },
  {
    name: 'planOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'buyer', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'dailyRate', type: 'uint128' },
          { name: 'expiry', type: 'uint64' },
          { name: 'lastCharge', type: 'uint64' },
        ],
      },
    ],
  },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'buyer', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

interface Guard {
  triggerHf: number
  targetHf: number
  perDayUsd: number
  expiry: number
  loans: number
  prepaidUsd: number
  daysCovered: number | null
}

async function readGuard(buyer: string): Promise<Guard | null> {
  const client = createPublicClient({ chain: bsc, transport: fallback(webRpcUrls(56).map((u) => http(u))) })
  const owner = buyer as `0x${string}`
  const [mandate, plan, prepaid] = await Promise.all([
    client.readContract({ address: GUARD_OPERATOR, abi: GUARD_ABI, functionName: 'mandateOf', args: [owner] }),
    client.readContract({ address: GUARD_SUBSCRIPTION, abi: GUARD_ABI, functionName: 'planOf', args: [owner] }),
    client.readContract({ address: GUARD_SUBSCRIPTION, abi: GUARD_ABI, functionName: 'balanceOf', args: [owner] }),
  ])
  if (!mandate.active) return null
  const prepaidUsd = Number(formatUnits(prepaid, 18))
  const rate = Number(formatUnits(plan.dailyRate, 18))
  return {
    triggerHf: mandate.triggerBps / 10_000,
    targetHf: mandate.targetBps / 10_000,
    perDayUsd: Number(formatUnits(mandate.maxRepayPerDay, 18)),
    expiry: Number(mandate.expiry),
    loans: mandate.positions.length,
    prepaidUsd,
    daysCovered: rate > 0 ? Math.floor(prepaidUsd / rate) : null,
  }
}

interface FluxSummary {
  count: number
  valueUsd: number
  inRange: number
}

// Flux LP keeps its own portfolio; this is one line saying the money is there, with a link to it
async function readFlux(owner: string): Promise<FluxSummary | null> {
  const res = await fetch(`https://fluxlp.agentsouk.xyz/positions?owner=${owner}`)
  if (!res.ok) return null
  const body = (await res.json()) as { positions?: { liquidity: string; valueUsd: number; inRange: boolean }[] }
  const open = (body.positions ?? []).filter((p) => p.liquidity !== '0')
  return { count: open.length, valueUsd: open.reduce((s, p) => s + p.valueUsd, 0), inRange: open.filter((p) => p.inRange).length }
}

function GuardRow({ g }: { g: Guard }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-souk-ink">Souk Health Guard</span>
        <span className="block text-[12.5px] leading-[18px] text-souk-steel">
          Watching {g.loans} Venus loan{g.loans === 1 ? '' : 's'}: repays when health falls to {g.triggerHf.toFixed(2)}, back up to{' '}
          {g.targetHf.toFixed(2)}, at most {usd(g.perDayUsd)} a day, {endsIn(g.expiry)}
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[12.5px]">
        <span className="text-souk-steel">
          prepaid <span className="text-souk-ink">{usd(g.prepaidUsd)}</span>
          {g.daysCovered !== null ? `, about ${g.daysCovered} day${g.daysCovered === 1 ? '' : 's'}` : ''}
        </span>
        <Link to="/defend" className="font-sans text-[12px] text-souk-sky hover:underline">
          Change limits
        </Link>
      </span>
    </li>
  )
}

function HireRow({ r }: { r: Row }) {
  const result = r.open ? r.pnl : r.realized
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-souk-ink">
          {r.agentName ?? `Agent ${r.agent.slice(0, 6)}...${r.agent.slice(-4)}`}
          {r.chainId === 97 ? <span className="ml-2 font-mono text-[10px] uppercase text-souk-labels">testnet</span> : null}
        </span>
        <span className="block text-[12.5px] leading-[18px] text-souk-steel">
          Vault hire {r.id}
          {r.trades !== null ? `, ${r.trades} trade${r.trades === 1 ? '' : 's'}` : ''}
          {r.open ? `, ${endsIn(r.expiry)}` : ', closed'}
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[12.5px]">
        <span className="text-souk-steel">
          put in <span className="text-souk-ink">{usd(r.deposit)}</span>
        </span>
        {r.open ? (
          <span className="text-souk-steel">
            worth now <span className="text-souk-ink">{r.value !== null ? usd(r.value) : 'not readable now'}</span>
          </span>
        ) : null}
        <span className={result === null ? 'text-souk-labels' : result >= 0 ? 'text-souk-good' : 'text-souk-peach'}>
          {result === null ? 'result not readable' : signed(result)}
        </span>
        <Link to="/vault" className="font-sans text-[12px] text-souk-sky hover:underline">
          {r.open ? 'Manage or withdraw' : 'See it'}
        </Link>
      </span>
    </li>
  )
}

// where this wallet's money is working, read from the vault contract through our API. every figure
// is the contract's or the price feed's; one that cannot be read says so instead of guessing
export function Portfolio({ account }: { account: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [guard, setGuard] = useState<Guard | null>(null)
  const [flux, setFlux] = useState<FluxSummary | null>(null)

  useEffect(() => {
    let alive = true
    setGuard(null)
    setFlux(null)
    readGuard(account)
      .then((g) => {
        if (alive) setGuard(g)
      })
      .catch(() => {})
    readFlux(account)
      .then((f) => {
        if (alive) setFlux(f)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [account])

  useEffect(() => {
    let alive = true
    setRows(null)
    setFailed(false)
    Promise.all(CHAINS.map((c) => readChain(account, c).catch(() => [] as Row[])))
      .then((lists) => {
        if (alive) setRows(lists.flat())
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [account])

  if (failed) return <p className="text-[13px] text-souk-steel">Your vault hires could not be read just now.</p>
  if (!rows) return <p className="text-[13px] text-souk-steel">Reading where your money is working...</p>

  const open = rows.filter((r) => r.open)
  const closed = rows.filter((r) => !r.open)
  const mainOpen = open.filter((r) => r.chainId === 56)
  const readable = mainOpen.filter((r) => r.value !== null)
  const working = readable.reduce((s, r) => s + (r.value ?? 0), 0)
  const result = readable.reduce((s, r) => s + (r.pnl ?? 0), 0)

  return (
    <section aria-label="Your portfolio" className="grid gap-4">
      <div>
        <h2 className="m-0 text-[18px] font-semibold text-souk-ink">Where your money is working</h2>
        {rows.length === 0 && !guard ? (
          <p className="mt-1 text-[13px] leading-[19px] text-souk-steel">
            No vault hires yet. In a vault hire your money stays in a contract and the agent trades only inside your limits.{' '}
            <Link to="/vault" className="text-souk-sky hover:underline">
              Open one
            </Link>
            .
          </p>
        ) : (
          <p className="mt-1 text-[14px] leading-[20px] text-souk-slate">
            {mainOpen.length
              ? `${usd(working)} working in ${mainOpen.length} vault hire${mainOpen.length === 1 ? '' : 's'} on mainnet, `
              : 'Nothing working on mainnet right now. '}
            {mainOpen.length ? (
              <span className={result >= 0 ? 'text-souk-good' : 'text-souk-peach'}>{signed(result)} so far</span>
            ) : null}
            {readable.length < mainOpen.length ? ' (some values could not be read and are left out)' : ''}
          </p>
        )}
      </div>

      {open.length || guard ? (
        <ul className="divide-y divide-souk-hair rounded-[14px] border border-souk-hair">
          {open.map((r) => (
            <HireRow key={`${r.chainId}-${r.id}`} r={r} />
          ))}
          {guard ? <GuardRow g={guard} /> : null}
        </ul>
      ) : null}

      {flux && flux.count > 0 ? (
        <p className="m-0 flex flex-wrap items-baseline justify-between gap-2 rounded-[14px] border border-souk-hair px-4 py-3 text-[13px] text-souk-slate">
          <span>
            <span className="font-semibold text-souk-ink">Flux LP</span>: {flux.count} position{flux.count === 1 ? '' : 's'},{' '}
            <span className="font-mono text-souk-ink">{usd(flux.valueUsd)}</span>, {flux.inRange} of {flux.count} in range
          </span>
          <a href="https://fluxlp.agentsouk.xyz" target="_blank" rel="noreferrer" className="text-[12px] text-souk-sky hover:underline">
            Open in Flux LP
          </a>
        </p>
      ) : null}

      {closed.length ? (
        <details className="rounded-[14px] border border-souk-hair">
          <summary className="cursor-pointer px-4 py-3 text-[13px] text-souk-slate">Finished vault hires ({closed.length})</summary>
          <ul className="divide-y divide-souk-hair border-t border-souk-hair">
            {closed.map((r) => (
              <HireRow key={`${r.chainId}-${r.id}`} r={r} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
