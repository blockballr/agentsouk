import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { button } from '../components/ui'

type ScoutCandidate = {
  agent_id: string
  token_id: string
  chain_id: number
  name: string
  description: string | null
  category: string
  endpoint: string | null
  endpointType: 'mcp' | 'a2a' | null
  source: string
  discoveredAt: string
}

type DiscoverView = {
  updatedAt: string | null
  fetched: number
  counts: Record<string, number>
  candidates: number
  log?: { errors?: string[]; discovered?: number } | null
}

type VerifyResult = {
  tokenId: string
  name: string
  category: string
  status: string
  responseMs: number
  detail: string
}

type VerifyView = {
  updatedAt?: string
  probed?: number
  delivered?: number
  dead?: number
  unreachable?: number
  results?: VerifyResult[]
}

const statusTone: Record<string, string> = {
  delivered: 'border-highlighter-green/50 text-green-ink',
  dead: 'border-press-black/30 text-press-black',
  unreachable: 'border-slate-verdant/40 text-newsprint-gray',
  gated: 'border-slate-verdant/40 text-newsprint-gray',
}

export function ScoutPage() {
  const [discover, setDiscover] = useState<DiscoverView | null>(null)
  const [verify, setVerify] = useState<VerifyView | null>(null)
  const [candidates, setCandidates] = useState<ScoutCandidate[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [secret, setSecret] = useState('')

  const load = useCallback(async () => {
    try {
      const [statusRes, candRes, verifyRes] = await Promise.all([
        fetch('/api/scout/status'),
        fetch('/api/scout/discover'),
        fetch('/api/scout/verify'),
      ])
      const status = await statusRes.json()
      const cand = await candRes.json()
      const ver = await verifyRes.json()
      setDiscover({
        updatedAt: status.scout?.discover?.updatedAt ?? cand.updatedAt ?? null,
        fetched: status.scout?.discover?.fetched ?? cand.fetched ?? 0,
        counts: status.scout?.discover?.counts ?? cand.counts ?? {},
        candidates: status.scout?.discover?.candidates ?? cand.candidates ?? 0,
        log: status.scout?.log ?? null,
      })
      setVerify(ver.results ? ver : { probed: ver.probed ?? 0 })
      if (Array.isArray(cand.agents)) {
        setCandidates(cand.agents as ScoutCandidate[])
      } else {
        setCandidates([])
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load scout')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runDiscover() {
    if (!secret.trim()) {
      setError('Enter INDEX_SECRET to run discover')
      return
    }
    setRunning('discover')
    setError(null)
    try {
      const res = await fetch(
        `/api/scout/discover?secret=${encodeURIComponent(secret.trim())}&terms=1&pages=0&limit=80`,
        { method: 'POST' },
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error ?? `discover ${res.status}`)
      const listRes = await fetch('/api/scout/discover')
      const list = await listRes.json()
      setDiscover({
        updatedAt: body.log?.completedAt ?? null,
        fetched: body.fetched ?? 0,
        counts: body.byCategory ?? {},
        candidates: body.candidates ?? 0,
        log: body.log ?? null,
      })
      if (Array.isArray(body.agents)) setCandidates(body.agents)
      void list
    } catch (e) {
      setError(e instanceof Error ? e.message : 'discover failed')
    } finally {
      setRunning(null)
    }
  }

  async function runVerify() {
    if (!secret.trim()) {
      setError('Enter INDEX_SECRET to run verify')
      return
    }
    setRunning('verify')
    setError(null)
    try {
      const res = await fetch(
        `/api/scout/verify?secret=${encodeURIComponent(secret.trim())}&limit=8`,
        { method: 'POST' },
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error ?? `verify ${res.status}`)
      setVerify(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'verify failed')
    } finally {
      setRunning(null)
    }
  }

  const verifiedByToken = new Map((verify?.results ?? []).map((r) => [r.tokenId, r]))
  const filtered =
    filter === 'all'
      ? candidates
      : candidates.filter((c) => c.category === filter)

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Registry Scout (local preview)</p>
      <h1 className="mt-4 font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Scout.
      </h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Discover specialist agents from the full ERC-8004 registry, probe their
        endpoints, and grade delivery. Not deployed to production. Data from{' '}
        <span className="font-mono text-press-black">data/scout/</span> via local API.
      </p>

      <div className="mt-8 flex flex-wrap items-end gap-4">
        <label className="micro text-newsprint-gray">
          INDEX_SECRET
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="dev or your secret"
            className="mt-2 block w-56 rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-xs text-press-black"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className={button('secondary', 'md')}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void runDiscover()}
          disabled={running === 'discover'}
          className={button('primary', 'md')}
        >
          {running === 'discover' ? 'Discovering…' : 'Run discover'}
        </button>
        <button
          type="button"
          onClick={() => void runVerify()}
          disabled={running === 'verify'}
          className="micro rounded-[5px] border hairline border-highlighter-green/50 px-4 py-2.5 text-green-ink hover:bg-highlighter-green/10 disabled:opacity-60"
        >
          {running === 'verify' ? 'Verifying…' : 'Run verify (8)'}
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
          {error}
        </p>
      )}

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Fetched" value={String(discover?.fetched ?? 0)} />
        <Metric label="Candidates" value={String(discover?.candidates ?? 0)} />
        <Metric
          label="Delivered / probed"
          value={`${verify?.delivered ?? 0} / ${verify?.probed ?? 0}`}
        />
        <Metric label="Stale" value={String(verify?.dead ?? 0)} />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {['all', 'rebalancing', 'grid-trading', 'yield', 'health-factor'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`micro rounded-full border hairline px-3 py-1.5 ${
              filter === key
                ? 'border-highlighter-green bg-highlighter-green/10 text-green-ink'
                : 'border-slate-verdant/40 text-newsprint-gray'
            }`}
          >
            {key}
            {discover?.counts?.[key] !== undefined && key !== 'all'
              ? ` (${discover.counts[key]})`
              : key === 'all'
                ? ` (${candidates.length})`
                : ''}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 metal rounded-[14px] border hairline border-slate-verdant/40 p-10">
          <p className="text-[15px] text-newsprint-gray">No scout candidates loaded yet.</p>
          <p className="mt-2 text-[13px] text-newsprint-gray/80">
            Click Run discover (needs INDEX_SECRET), then Refresh. Candidates appear here.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {filtered.slice(0, 60).map((c) => {
            const v = verifiedByToken.get(c.token_id)
            return (
              <article
                key={c.agent_id}
                className="metal rounded-[12px] border hairline border-slate-verdant/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/agents/${c.chain_id}/${c.token_id}`}
                      className="font-serif text-[22px] leading-none text-press-black hover:text-highlighter-green"
                    >
                      {c.name}
                    </Link>
                    <p className="micro mt-2 text-newsprint-gray">
                      {c.category} · {c.source} · token {c.token_id}
                      {c.endpointType ? ` · ${c.endpointType}` : ''}
                    </p>
                    {c.description && (
                      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-newsprint-gray line-clamp-2">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    {v ? (
                      <span
                        className={`micro rounded-full border hairline px-2.5 py-1 ${statusTone[v.status] ?? statusTone.unreachable}`}
                      >
                        {v.status} · {v.responseMs}ms
                      </span>
                    ) : (
                      <span className="micro text-newsprint-gray/70">not probed</span>
                    )}
                    {v?.detail && (
                      <p className="mt-2 max-w-[220px] font-mono text-[11px] text-newsprint-gray">
                        {v.detail}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {(verify?.results?.length ?? 0) > 0 && (
        <div className="mt-14">
          <p className="micro text-newsprint-gray">Latest verify run</p>
          <div className="mt-4 space-y-2">
            {(verify?.results ?? []).slice(0, 12).map((r) => (
              <div
                key={r.tokenId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border hairline border-slate-verdant/30 px-4 py-3 text-[13px]"
              >
                <span className="text-typesetter-ink">{r.name}</span>
                <span className="flex items-center gap-3">
                  <span className="micro text-newsprint-gray">{r.category}</span>
                  <span
                    className={`micro rounded-full border hairline px-2.5 py-1 ${statusTone[r.status] ?? ''}`}
                  >
                    {r.status}
                  </span>
                  <span className="font-mono text-[11px] text-newsprint-gray">{r.responseMs}ms</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {discover?.updatedAt && (
        <p className="micro mt-12 text-newsprint-gray">
          Last discover: {discover.updatedAt}
        </p>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border hairline border-slate-verdant/40 p-5">
      <div className="micro text-newsprint-gray">{label}</div>
      <div className="mt-2 font-serif text-[32px] leading-none text-press-black">{value}</div>
    </div>
  )
}
