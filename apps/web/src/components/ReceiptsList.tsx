import { useEffect, useState } from 'react'
import { Stack, Row, Txt } from './souk'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface Receipt {
  id: string
  chainId: number
  hireId: string
  agent: string
  status: 'traded' | 'skipped' | 'refused'
  reason: string | null
  txHash: string | null
  blockNumber: number | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  trigger: Record<string, unknown> | null
  guardrail: Record<string, unknown> | null
  simulation: Record<string, unknown> | null
  policy: string
  createdAt: string
}

interface Replay {
  expectedAction: string
  recordedAction: string
  matches: boolean
  triggerHolds: boolean
  checks: { name: string; holds: boolean; detail: string }[]
  notReplayed: string[]
}

type ReplayState = Replay | 'loading' | 'error'

export function ReceiptsList({ agent, hireId, chainId = 97 }: { agent?: string; hireId?: string; chainId?: number }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [replays, setReplays] = useState<Record<string, ReplayState>>({})

  useEffect(() => {
    const params = new URLSearchParams()
    if (chainId) params.set('chainId', String(chainId))
    if (hireId) params.set('hireId', hireId)
    if (agent) params.set('agent', agent)
    const url = `${API_BASE}/vault/receipts?${params}`
    const load = () => {
      fetch(url)
        .then((r) => r.json())
        .then((b) => { if (b?.success) setReceipts(b.receipts ?? []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      load()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [agent, hireId, chainId])

  async function replay(id: string) {
    setReplays((s) => ({ ...s, [id]: 'loading' }))
    try {
      const res = await fetch(`${API_BASE}/vault/replay?id=${encodeURIComponent(id)}`)
      const body = await res.json()
      if (!body?.success) throw new Error('replay failed')
      setReplays((s) => ({ ...s, [id]: body.replay as Replay }))
    } catch {
      setReplays((s) => ({ ...s, [id]: 'error' }))
    }
  }

  if (loading) return <Txt size={11} lead={16} tone="muted">Loading receipts...</Txt>
  if (receipts.length === 0) return <Txt size={11} lead={16} tone="muted">No receipts yet.</Txt>

  return (
    <Stack gap={6}>
      {receipts.map((r) => {
        const replayState = replays[r.id]
        return (
          <Stack key={r.id} gap={2} surface pad={[8, 12, 8, 12]}>
            <Row gap={8} align="center">
              <Txt size={11} lead={16} mono tone="ink">{r.policy}</Txt>
              <span className={`inline-block h-2 w-2 rounded-full ${r.status === 'traded' ? 'bg-souk-good' : r.status === 'refused' ? 'bg-red-500' : 'bg-zinc-500'}`} />
              <Txt size={11} lead={16} tone={r.status === 'traded' ? 'ink' : 'muted'}>{r.status}</Txt>
              <Txt size={10} lead={14} mono tone="muted" className="ml-auto">
                {r.blockNumber != null ? `block ${r.blockNumber} · ` : ''}
                {new Date(r.createdAt).toLocaleString()}
              </Txt>
            </Row>
            {r.reason && <Txt size={10} lead={14} tone="muted">{r.reason.slice(0, 120)}</Txt>}
            {r.trigger && (
              <Txt size={10} lead={14} mono tone="muted">
                {Object.entries(r.trigger).map(([k, v]) => `${k}=${String(v)}`).join(' ')}
              </Txt>
            )}
            {r.txHash && <Txt size={10} lead={14} mono tone="muted">tx: {r.txHash}</Txt>}
            <Row gap={8} align="center">
              <button
                type="button"
                onClick={() => replay(r.id)}
                disabled={replayState === 'loading'}
                className="rounded-[6px] border border-souk-hair px-2 py-1 text-[10px] font-semibold text-souk-slate transition hover:bg-souk-surface2 disabled:opacity-50"
              >
                {replayState === 'loading' ? 'Replaying...' : 'Replay check'}
              </button>
              {replayState && replayState !== 'loading' && replayState !== 'error' && (
                <Txt size={10} lead={14} tone={replayState.matches ? 'ink' : 'muted'}>
                  {replayState.matches ? 'trigger holds, decision matches' : `trigger no longer holds (expected ${replayState.expectedAction}, recorded ${replayState.recordedAction})`}
                </Txt>
              )}
              {replayState === 'error' && <Txt size={10} lead={14} tone="muted">replay unavailable</Txt>}
            </Row>
            {replayState && replayState !== 'loading' && replayState !== 'error' && (
              <Stack gap={1}>
                {replayState.checks.map((c) => (
                  <Txt key={c.name} size={10} lead={14} mono tone="muted">
                    {c.holds ? 'ok' : 'no'} · {c.name} · {c.detail}
                  </Txt>
                ))}
                {replayState.notReplayed.length > 0 && (
                  <Txt size={10} lead={14} mono tone="muted">not replayed: {replayState.notReplayed.join(', ')}</Txt>
                )}
              </Stack>
            )}
          </Stack>
        )
      })}
    </Stack>
  )
}
