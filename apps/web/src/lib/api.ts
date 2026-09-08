import type { AgentDetail, AgentSummary, PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'

// the standalone API, co-hosted behind /api in production
const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface AgentsQuery {
  category?: string
  q?: string
  sort?: 'score' | 'newest' | 'feedback' | 'health'
  page?: number
  limit?: number
  pcs?: boolean
}

export interface AgentsResult {
  items: AgentSummary[]
  total: number
  snapshotTotal: number | null
  counts: Record<string, number>
}

export async function getAgents(query: AgentsQuery = {}): Promise<AgentsResult> {
  const sp = new URLSearchParams()
  if (query.category && query.category !== 'all') sp.set('category', query.category)
  if (query.q) sp.set('q', query.q)
  if (query.sort) sp.set('sort', query.sort)
  if (query.page && query.page > 1) sp.set('page', String(query.page))
  if (query.limit) sp.set('limit', String(query.limit))
  if (query.pcs) sp.set('pcs', '1')
  const res = await fetch(`${BASE}/agents?${sp}`)
  if (!res.ok) throw new Error(`agents ${res.status}`)
  const body = await res.json()
  return {
    items: body.items ?? [],
    total: body.total ?? 0,
    snapshotTotal: body.snapshotTotal ?? null,
    counts: body.counts ?? {},
  }
}

export async function getAgentDetail(
  chainId: string,
  tokenId: string,
): Promise<AgentDetail | null> {
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}`)
  if (!res.ok) return null
  const body = await res.json()
  return body.data ?? null
}

export async function getReceipt(paymentId: string): Promise<Receipt | null> {
  const res = await fetch(`${BASE}/receipts/${paymentId}`)
  if (!res.ok) return null
  return (await res.json()) as Receipt
}

export interface X402Requirements {
  success: boolean
  data: {
    paymentRequirements: PaymentRequirements
    preview: PreviewResult
    agent: { chainId: number; tokenId: string; name: string; image: string | null; symbol: string }
  }
}

export async function getHireRequirements(
  chainId: string,
  tokenId: string,
  client?: string,
): Promise<X402Requirements['data']> {
  const res = await fetch(`${BASE}/x402/requirements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId: Number(chainId), tokenId, client }),
  })
  if (!res.ok) throw new Error(`requirements ${res.status}`)
  const body: X402Requirements = await res.json()
  if (!body.success) throw new Error('requirements unavailable')
  return body.data
}

export interface SettleBody {
  paymentId: string
  paymentRequirements: PaymentRequirements
  paymentPayload: {
    x402Version: number
    payload: {
      authorization: {
        from: string
        to: string
        value: string
        validAfter: string
        validBefore: string
        nonce: string
        signature: string
      }
      resource: PreviewResult['resource']
    }
    resource: PreviewResult['resource']
    accepted: PaymentRequirements
  }
  agent: { chainId: number; tokenId: string; name: string; symbol: string }
}

export async function settleHire(body: SettleBody): Promise<SettleResult> {
  const res = await fetch(`${BASE}/x402/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result: SettleResult = await res.json()
  return result
}

export interface DeliverTool {
  name: string
  description: string
  schema: Record<string, unknown>
}

export interface DeliverData {
  protocol: 'mcp' | 'a2a'
  ok: boolean
  kind?: 'capabilities' | 'deliverable'
  text?: string
  gated?: boolean
  isError?: boolean
  error?: string
  tools?: DeliverTool[]
}

export interface DeliverBody {
  paymentId: string
  tool?: string
  args?: Record<string, unknown>
  task?: string
}

export async function deliverTask(body: DeliverBody): Promise<DeliverData> {
  const res = await fetch(`${BASE}/x402/deliver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload: { success: boolean; data?: DeliverData; error?: string } = await res.json()
  if (!payload.success) throw new Error(payload.error ?? `deliver ${res.status}`)
  return payload.data as DeliverData
}