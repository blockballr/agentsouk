import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BSC_CHAIN_ID } from '@agora/core'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

interface AdvantageReport {
  generatedAt: string
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
    settleMode: string
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
        <p className="mt-12 border hairline border-slate-verdant/20 px-10 py-16 text-center text-sm text-newsprint-gray">
          No advantage report captured yet.
        </p>
      ) : loading ? (
        <div className="mt-12 animate-pulse space-y-3" role="status" aria-label="Loading the advantage report">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-24 bg-slate-verdant/10" />
          ))}
        </div>
      ) : report === null || report.tasks.length === 0 ? (
        <p className="mt-12 border hairline border-slate-verdant/20 px-10 py-16 text-center text-sm text-newsprint-gray">
          No advantage report captured yet.
        </p>
      ) : (
        <Report report={report} />
      )}
    </section>
  )
}

function Report({ report }: { report: AdvantageReport }) {
  return (
    <div className="mt-12">
      <div className="border hairline border-slate-verdant/20 p-8">
        <p className="micro text-newsprint-gray">Methodology</p>
        <p className="mt-3 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          {report.methodology}
        </p>
        <p className="mt-4 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
          Captured {report.generatedAt}
        </p>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {report.tasks.map((t) => (
          <VerdictCard key={t.id} task={t} />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {report.tasks.map((t) => (
          <TaskDetail key={t.id} task={t} />
        ))}
      </div>
    </div>
  )
}

function VerdictCard({ task }: { task: AdvantageTask }) {
  return (
    <div className="flex flex-col gap-4 rounded-[14px] border hairline border-slate-verdant/20 p-8">
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
          <dt>Agent cost</dt>
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

function TaskDetail({ task }: { task: AdvantageTask }) {
  return (
    <article className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="micro text-newsprint-gray">{task.category}</span>
        <SettleBadge settleMode={task.agent.settleMode} txHash={task.agent.txHash} />
      </div>
      <p className="mt-4 font-serif text-xl font-medium">
        <Link
          to={`/agents/${BSC_CHAIN_ID}/${task.agent.tokenId}`}
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

      <details className="mt-6 rounded-[10px] border hairline border-slate-verdant/20 p-4">
        <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
          Agent output
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-press-black">
          {task.agentOutput}
        </pre>
      </details>
      <details className="mt-4 rounded-[10px] border hairline border-slate-verdant/20 p-4">
        <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
          Manual output
        </summary>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-press-black">
          {task.manualOutput}
        </pre>
      </details>

      <p className="mt-6 border-t hairline border-slate-verdant/20 pt-4 text-sm text-newsprint-gray">
        <span className="micro mr-3 text-press-black">Verdict</span>
        {task.verdict.notes}
      </p>
    </article>
  )
}

function SettleBadge({ settleMode, txHash }: { settleMode: string; txHash?: string }) {
  const isProd = settleMode === 'prod'
  const label = isProd ? 'settled on-chain' : settleMode
  return (
    <span
      className={`micro rounded-full border hairline px-2.5 py-1 ${
        isProd ? 'border-highlighter-green/50 text-highlighter-green' : 'border-slate-verdant/40 text-slate-verdant'
      }`}
    >
      {isProd && txHash ? (
        <a
          href={`https://bscscan.com/tx/${txHash}`}
          target="_blank"
          rel="noreferrer"
          className="hover:underline focus-visible:outline-2 focus-visible:outline-highlighter-green"
        >
          {label}
        </a>
      ) : (
        label
      )}
    </span>
  )
}

function formatUsd(usd?: number) {
  return typeof usd === 'number' ? `$${usd.toFixed(2)}` : '—'
}
