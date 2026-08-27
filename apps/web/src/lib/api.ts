import type { AgentDetail, AgentSummary } from '@agora/core'

// the standalone API, co-hosted behind /api in production
const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface AgentsQuery {
  category?: string
  q?: string
  sort?: 'score' | 'newest' | 'feedback' | 'health'
  page?: number
  limit?: number
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

export async function getReceipt(paymentId: string) {
  const res = await fetch(`${BASE}/receipts/${paymentId}`)
  if (!res.ok) return null
  return res.json()
}