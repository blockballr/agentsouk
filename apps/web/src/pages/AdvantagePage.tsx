import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getTargetChain } from '../lib/wallet'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

interface AdvantageAsset {
  symbol: string
  name?: string
  address?: string
}

interface AdvantageNetwork {
  key?: string
  status?: string
  chainId: number
  name: string
  asset?: AdvantageAsset
  explorer?: string
}

interface AdvantageCapture {
  measuredAt?: string
  rail?: string
  server?: string
  requestedChainId?: number
  settledOnChain?: boolean
  note?: string
}

interface AdvantageMainnet {
  status: string
  chainId: number
  name: string
  asset?: AdvantageAsset
  explorer?: string
  measuredAt?: string | null
  note?: string
}

interface AdvantageReport {
  generatedAt: string
  network?: AdvantageNetwork
  capture?: AdvantageCapture
  mainnet?: AdvantageMainnet
  methodology: string
  tasks: AdvantageTask[]
}

interface AdvantageTask {
  id: string
  category: string
  prompt: string
  agent: {
    tokenId: string
    name: string
    category: string
    chainId?: number
    settleMode: string
    settlementRef?: string
    txHash?: string
    statedFeeUsd?: number
  }
  agentOutput: string
  agentSeconds: number
  manualSeconds: number
  manualCostUsd: number
  manualOutput: string
  verdict: { winner: 'agent' | 'manual' | 'tie'; notes: string }
}

async function getAdvantageReport(): Promise<AdvantageReport> {
  const res = await fetch(`${BASE}/advantage`)
  if (!res.ok) throw new Error(`advantage ${res.status}`)
  const body: { success: boolean; data?: AdvantageReport } = await res.json()
  if (!body.success || !body.data) throw new Error('advantage unavailable')
  return body.data
}

export function AdvantagePage() {
  const [report, setReport] = useState<AdvantageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAdvantageReport()
      .then((r) => {
        if (!cancelled) setReport(r)
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
  }, [])

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Agent advantage</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Agent vs. manual.
      </h1>

      {error ? (
        <p className="mt-12 border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          No advantage report captured yet.
        </p>
      ) : loading ? (
        <div className="mt-12 animate-pulse space-y-3" role="status" aria-label="Loading the advantage report">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-24 bg-slate-verdant/10" />
          ))}
        </div>
      ) : report === null || !Array.isArray(report.tasks) || report.tasks.length === 0 ? (
        <p className="mt-12 border hairline border-slate-verdant/40 px-10 py-16 text-center text-sm text-newsprint-gray">
          No advantage report captured yet.
        </p>
      ) : (
        <Report report={report} />
      )}
    </section>
  )
}

// the report is data-driven: network says which chain this run belongs to, capture says
// how it was measured, and mainnet stays a labelled slot until a mainnet run fills it
function Report({ report }: { report: AdvantageReport }) {
  return (
    <div className="mt-12">
      <NetworkPanel report={report} />

      <div className="mt-6 border hairline border-slate-verdant/40 p-8">
        <p className="micro text-newsprint-gray">Methodology</p>
        <p className="mt-3 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          {report.methodology}
        </p>
        {report.capture ? null : (
          <p className="mt-4 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
            Captured {report.generatedAt}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {report.tasks.map((t) => (
          <VerdictCard key={t.id} task={t} />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {report.tasks.map((t) => (
          <TaskDetail key={t.id} task={t} report={report} />
        ))}
      </div>
    </div>
  )
}

function NetworkPanel({ report }: { report: AdvantageReport }) {
  const network = report.network
  const capture = report.capture
  const mainnet = report.mainnet
  const openMainnet = mainnet !== undefined && mainnet.status === 'pending' && mainnet.chainId !== network?.chainId
  if (!network && !openMainnet) return null

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {network ? (
        <div className="border hairline border-slate-verdant/40 p-8">
          <p className="micro text-newsprint-gray">Network</p>
          <p className="mt-3 font-serif text-2xl font-medium">{network.name}</p>
          <p className="mt-1 text-sm text-newsprint-gray">{networkLine(network)}</p>
          {capture ? (
            <dl className="mt-5 space-y-2 text-sm text-newsprint-gray">
              <div className="flex justify-between gap-4">
                <dt>Captured</dt>
                <dd className="tabular-nums text-press-black">
                  {capture.measuredAt ?? report.generatedAt}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Rail</dt>
                <dd className="text-right text-press-black">{railLabel(capture)}</dd>
              </div>
            </dl>
          ) : null}
          {capture?.note ? (
            <p className="mt-5 max-w-3xl text-sm leading-snug text-newsprint-gray">{capture.note}</p>
          ) : null}
        </div>
      ) : null}

      {openMainnet && mainnet ? (
        <div className="border hairline border-slate-verdant/40 p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="micro text-newsprint-gray">Mainnet</p>
            <span className="micro rounded-full border hairline border-slate-verdant/40 px-2.5 py-1 text-slate-verdant">
              Pending cutover
            </span>
          </div>
          <p className="mt-3 font-serif text-2xl font-medium">{mainnet.name}</p>
          <p className="mt-1 text-sm text-newsprint-gray">{networkLine(mainnet)}</p>
          {mainnet.note ? (
            <p className="mt-5 max-w-3xl text-sm leading-snug text-newsprint-gray">{mainnet.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function networkLine(network: { chainId: number; asset?: AdvantageAsset }) {
  return network.asset
    ? `Chain ${network.chainId} · settles in ${network.asset.symbol}`
    : `Chain ${network.chainId}`
}

function railLabel(capture: AdvantageCapture) {
  if (capture.settledOnChain) return capture.rail ?? 'on chain'
  return capture.rail === 'sandbox' ? 'sandbox, no funds moved' : (capture.rail ?? 'not settled on chain')
}

function VerdictCard({ task }: { task: AdvantageTask }) {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <p className="micro text-newsprint-gray">{task.category}</p>
      <p className="font-serif text-2xl font-medium">{task.verdict.winner}</p>
      <dl className="mt-auto space-y-2 text-sm text-newsprint-gray">
        <div className="flex justify-between gap-4">
          <dt>Agent time</dt>
          <dd className="tabular-nums text-press-black">{task.agentSeconds}s</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Manual time</dt>
          <dd className="tabular-nums text-press-black">{task.manualSeconds}s</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Agent fee (stated)</dt>
          <dd className="tabular-nums text-press-black">{formatUsd(task.agent.statedFeeUsd)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Manual cost</dt>
          <dd className="tabular-nums text-press-black">{formatUsd(task.manualCostUsd)}</dd>
        </div>
      </dl>
    </div>
  )
}

function TaskDetail({ task, report }: { task: AdvantageTask; report: AdvantageReport }) {
  const chainId = task.agent.chainId ?? report.network?.chainId ?? getTargetChain()
  return (
    <article className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="micro text-newsprint-gray">{task.category}</span>
        <SettleBadge task={task} explorer={report.network?.explorer} />
      </div>
      <p className="mt-4 font-serif text-xl font-medium">
        <Link
          to={`/agents/${chainId}/${task.agent.tokenId}`}
          className="hover:text-highlighter-green focus-visible:outline-2 focus-visible:outline-highlighter-green"
        >
          {task.agent.name}
        </Link>
      </p>
      <p className="micro mt-1 text-newsprint-gray">{task.agent.category}</p>
      <p className="mt-4 max-w-3xl text-sm leading-snug text-press-black">{task.prompt}</p>
      <p className="mt-4 text-sm text-newsprint-gray">
        Agent {task.agentSeconds}s vs manual {task.manualSeconds}s
      </p>

      <details className="mt-6 rounded-[10px] border hairline border-slate-verdant/40 p-4">
        <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
          Agent output
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-press-black">
          {task.agentOutput}
        </pre>
      </details>
      <details className="mt-4 rounded-[10px] border hairline border-slate-verdant/40 p-4">
        <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
          Manual output
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-press-black">
          {task.manualOutput}
        </pre>
      </details>

      <p className="mt-6 border-t hairline border-slate-verdant/40 pt-4 text-sm text-newsprint-gray">
        <span className="micro mr-3 text-press-black">Verdict</span>
        {task.verdict.notes}
      </p>
    </article>
  )
}

// a sandbox reference is a session record, not a chain transaction, so it never renders as a receipt
function SettleBadge({ task, explorer }: { task: AdvantageTask; explorer?: string }) {
  const ref = task.agent.settlementRef ?? task.agent.txHash
  const isProd = task.agent.settleMode === 'prod'
  const label = isProd ? 'settled on-chain' : 'sandbox session, no funds moved'
  const tone = isProd ? 'border-highlighter-green/50 text-highlighter-green' : 'border-slate-verdant/40 text-slate-verdant'

  if (isProd && ref && explorer) {
    return (
      <a
        href={`${explorer}/tx/${ref}`}
        target="_blank"
        rel="noreferrer"
        className={`micro rounded-full border hairline px-2.5 py-1 hover:underline ${tone}`}
      >
        {label}
      </a>
    )
  }
  return <span className={`micro rounded-full border hairline px-2.5 py-1 ${tone}`}>{label}</span>
}

function formatUsd(usd?: number) {
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : '·'
}
