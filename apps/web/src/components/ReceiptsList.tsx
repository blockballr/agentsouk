import { useEffect, useState } from 'react'
import { explorerTxBase } from '../lib/contracts'
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

// both live vaults bind WBNB as token A and USDT as token B, 18 decimals each
const TOKEN_A = 'WBNB'
const TOKEN_B = 'USDT'

function units(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  try {
    return Number(BigInt(String(raw))) / 1e18
  } catch {
    return null
  }
}

function amount(value: number): string {
  if (value === 0) return '0'
  if (value < 0.0001) return value.toPrecision(3)
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

// a trade in words, from the balances the receipt recorded either side of it
export function tradeSentence(r: Pick<Receipt, 'before' | 'after' | 'trigger'>): string {
  const side = String(r.trigger?.side ?? '')
  const price = Number(r.trigger?.rungPrice ?? r.trigger?.refPrice)
  const a0 = units(r.before?.balanceA)
  const a1 = units(r.after?.balanceA)
  const b0 = units(r.before?.balanceB)
  const b1 = units(r.after?.balanceB)
  const at = Number.isFinite(price) ? ` at ${price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${TOKEN_B}` : ''
  if (a0 !== null && a1 !== null && b0 !== null && b1 !== null) {
    if (side === 'sellA' || a1 < a0) return `Sold ${amount(a0 - a1)} ${TOKEN_A} for ${amount(b1 - b0)} ${TOKEN_B}${at}`
    if (side === 'buyA' || a1 > a0) return `Bought ${amount(a1 - a0)} ${TOKEN_A} for ${amount(b0 - b1)} ${TOKEN_B}${at}`
  }
  if (side === 'sellA') return `Sold ${TOKEN_A}${at}`
  if (side === 'buyA') return `Bought ${TOKEN_A}${at}`
  return 'Traded inside the hire'
}

// the engine writes prices at full float precision; two decimals is what a reader needs
export function roundNumbers(text: string): string {
  return text.replace(/\d+\.\d{3,}/g, (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ReceiptsList({ agent, hireId, chainId = 97 }: { agent?: string; hireId?: string; chainId?: number }) {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [replays, setReplays] = useState<Record<string, ReplayState>>({})
  const [showChecks, setShowChecks] = useState(false)

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

  if (loading) return <Txt size={12} lead={18} tone="muted">Reading the receipts.</Txt>
  if (receipts.length === 0) return <Txt size={12} lead={18} tone="muted">No trades yet.</Txt>

  const trades = receipts.filter((r) => r.status === 'traded')
  const checks = receipts.filter((r) => r.status !== 'traded')

  const replayLine = (r: Receipt) => {
    const state = replays[r.id]
    return (
      <>
        <button
          type="button"
          onClick={() => replay(r.id)}
          disabled={state === 'loading'}
          className="text-[11px] text-souk-sky underline-offset-2 transition hover:text-souk-ink hover:underline disabled:opacity-50"
        >
          {state === 'loading' ? 'Checking' : 'Check it again'}
        </button>
        {state && state !== 'loading' && state !== 'error' ? (
          <Txt size={11} lead={16} tone={state.matches ? 'ink' : 'muted'}>
            {state.matches ? 'The same decision holds today.' : `Today it would ${state.expectedAction}, not ${state.recordedAction}.`}
          </Txt>
        ) : null}
        {state === 'error' ? <Txt size={11} lead={16} tone="muted">The check could not run just now.</Txt> : null}
      </>
    )
  }

  return (
    <Stack gap={10}>
      {trades.length === 0 ? (
        <Txt size={12} lead={18} tone="muted">No trades yet.</Txt>
      ) : (
        <ul className="divide-y divide-souk-hair border-y border-souk-hair">
          {trades.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3">
              <Row justify="between" align="center" gap={12} className="flex-wrap">
                <Txt size={14} lead={20} weight="semibold" tone="ink">
                  {tradeSentence(r)}
                </Txt>
                <Txt size={11} lead={16} mono tone="labels">
                  {when(r.createdAt)}
                </Txt>
              </Row>
              {r.guardrail && typeof r.guardrail.reason === 'string' ? (
                <Txt size={12} lead={18} tone="steel">
                  Why: {roundNumbers(r.guardrail.reason)}
                </Txt>
              ) : null}
              <Row gap={12} align="center" className="flex-wrap">
                {r.txHash ? (
                  <a
                    href={`${explorerTxBase(chainId)}/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-souk-sky underline-offset-2 transition hover:text-souk-ink hover:underline"
                  >
                    Transaction
                  </a>
                ) : null}
                {replayLine(r)}
              </Row>
            </li>
          ))}
        </ul>
      )}

      {checks.length > 0 ? (
        <Stack gap={6}>
          <button
            type="button"
            onClick={() => setShowChecks((v) => !v)}
            aria-expanded={showChecks}
            className="w-fit text-left text-[12px] text-souk-steel transition hover:text-souk-ink"
          >
            Checked {checks.length} more {checks.length === 1 ? 'time' : 'times'} without trading.{' '}
            <span className="text-souk-sky">{showChecks ? 'Hide' : 'Show'}</span>
          </button>
          {showChecks ? (
            <ul className="flex flex-col gap-2">
              {checks.map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 border-l border-souk-hair pl-3">
                  <Txt size={12} lead={18} tone="slate">
                    {r.status === 'refused' ? 'Refused: ' : ''}
                    {r.reason ? roundNumbers(r.reason) : 'Nothing to do.'}
                  </Txt>
                  <Row gap={12} align="center" className="flex-wrap">
                    <Txt size={11} lead={16} mono tone="labels">
                      {when(r.createdAt)}
                    </Txt>
                    {replayLine(r)}
                  </Row>
                </li>
              ))}
            </ul>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  )
}
