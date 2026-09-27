import type { AgentDetail, AgentSummary, PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
import { getActiveAccount, getProvider, setTargetChain } from './wallet'

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
  const body = await readJsonBody<{
    items?: AgentSummary[]
    total?: number
    snapshotTotal?: number | null
    counts?: Record<string, number>
  }>(res, 'agents')
  const items: AgentSummary[] = body.items ?? []
  // learn the chain from the catalogue rather than shipping it as a constant, so
  // a hardcoded chain cannot silently disagree with the deployment
  const chain = items[0]?.chain_id
  if (typeof chain === 'number' && chain > 0) setTargetChain(chain)
  return {
    items,
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
  const body = await readJsonBody<{ data?: AgentDetail }>(res, 'agent')
  return body.data ?? null
}

export async function getReceipt(paymentId: string): Promise<Receipt | null> {
  const res = await fetch(`${BASE}/receipts/${paymentId}`)
  if (!res.ok) return null
  return readJsonBody<Receipt>(res, 'receipt')
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
  const body = await readJsonBody<X402Requirements>(res, 'requirements')
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
  return readJsonBody<SettleResult>(res, 'settle')
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

export interface CompareCommentaryAgent {
  name: string
  category: string
  score: number
  feedbacks: number
  verified: boolean
  verification?: {
    status?: string
    quality?: { grade?: string; reason?: string }
  }
  pcs?: boolean
  fee?: string | number
}

export interface CompareCommentaryBody {
  agents: CompareCommentaryAgent[]
  winners: { category: string; name: string }[]
  language?: string
}

export async function getCompareCommentary(
  body: CompareCommentaryBody,
): Promise<{ commentary: string; model: string } | null> {
  try {
    const res = await fetch(`${BASE}/compare/commentary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await readJsonBody<{ success?: boolean; commentary?: unknown; model?: unknown }>(
      res,
      'commentary',
    )
    if (!data.success || typeof data.commentary !== 'string' || !data.commentary.trim()) {
      return null
    }
    return {
      commentary: data.commentary,
      model: typeof data.model === 'string' ? data.model : 'ai',
    }
  } catch {
    return null
  }
}

// A route that throws answers with an empty body, and res.json() then reports
// "Unexpected end of JSON input", which tells the reader nothing. Read the
// body as text first so the status and the real reason survive.
export async function readJsonBody<T>(res: Response, what: string): Promise<T> {
  const raw = await res.text().catch(() => '')
  if (raw) {
    try {
      return JSON.parse(raw) as T
    } catch {
      // fall through to the message below
    }
  }
  if (res.status === 502 || res.status === 504) {
    throw new Error(`${what} returned ${res.status}: the marketplace timed out reaching the agent, try again`)
  }
  throw new Error(`${what} returned ${res.status} with no readable answer`)
}

export async function deliverTask(body: DeliverBody): Promise<DeliverData & { taskId?: string }> {
  const res = await fetch(`${BASE}/x402/deliver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readJsonBody<{ success: boolean; data?: DeliverData & { taskId?: string }; error?: string }>(
    res,
    'deliver',
  )
  if (!payload.success) throw new Error(payload.error ?? `deliver ${res.status}`)
  return payload.data as DeliverData & { taskId?: string }
}

export type HireTaskStatus = 'ready' | 'running' | 'delivered' | 'failed' | 'gated'

export interface HireTask {
  id: string
  paymentId: string
  chainId: number
  tokenId: string
  agentName: string
  status: HireTaskStatus
  tool?: string
  args?: Record<string, unknown>
  taskText?: string
  result?: string
  error?: string
  protocol?: 'mcp' | 'a2a'
  quality?: { score: number; grade: 'good' | 'partial' | 'poor'; reason: string }
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  history: { at: string; status: string; note?: string }[]
}

export interface TaskBundle {
  task: HireTask
  retry: { allowed: boolean; delayMs?: number }
  metrics: { tokenId: string; delivered: number; failed: number; gated: number; total: number; successRate: number; avgQuality: number }
}

export async function getTask(taskId: string): Promise<TaskBundle | null> {
  const res = await fetch(`${BASE}/tasks/${taskId}`)
  if (!res.ok) return null
  return readJsonBody<TaskBundle>(res, 'task')
}

export async function getTasksByPayment(paymentId: string): Promise<HireTask[]> {
  const res = await fetch(`${BASE}/tasks?paymentId=${encodeURIComponent(paymentId)}`)
  if (!res.ok) return []
  const body = await readJsonBody<{ tasks?: HireTask[] }>(res, 'tasks')
  return body.tasks ?? []
}

export async function retryTask(taskId: string): Promise<HireTask | null> {
  const res = await fetch(`${BASE}/tasks/${taskId}/retry`, { method: 'POST' })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.task) throw new Error(body?.error ?? `retry ${res.status}`)
  return body.task as HireTask
}

export interface ActiveHireSession {
  paymentId: string
  chainId: number
  tokenId: string
  agentName: string
  client: string
  spendCapUsd: number
  expiresAt: string
  mode: 'sandbox' | 'prod' | 'b402'
  createdAt: string
}

export type JobStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired'

export interface Erc8183Job {
  id: string
  client: string
  provider: string
  evaluator: string
  description: string
  chainId: number
  tokenId: string
  agentName: string
  paymentId?: string
  budgetUsd: number
  expiredAt: string
  status: JobStatus
  deliverable?: string
  attestation?: string
  taskId?: string
  createdAt: string
  updatedAt: string
}

export interface OngoingBundle {
  sessions: {
    session: ActiveHireSession
    task: HireTask | null
    job: Erc8183Job | null
  }[]
  recentTasks: {
    task: HireTask
    session: ActiveHireSession | null
    job: Erc8183Job | null
  }[]
  counts: {
    activeHires: number
    running: number
    ready: number
    delivered: number
    failed: number
    jobsFunded?: number
    jobsSubmitted?: number
    jobsCompleted?: number
  }
}

export async function getOngoing(client?: string | null): Promise<OngoingBundle> {
  const qs = client ? `?client=${encodeURIComponent(client)}` : ''
  const res = await fetch(`${BASE}/sessions${qs}`)
  if (!res.ok) throw new Error(`sessions ${res.status}`)
  const body = await readJsonBody<{
    sessions?: OngoingBundle['sessions']
    recentTasks?: OngoingBundle['recentTasks']
    counts?: OngoingBundle['counts']
  }>(res, 'sessions')
  return {
    sessions: body.sessions ?? [],
    recentTasks: body.recentTasks ?? [],
    counts: body.counts ?? {
      activeHires: 0,
      running: 0,
      ready: 0,
      delivered: 0,
      failed: 0,
    },
  }
}

export async function revokeSession(paymentId: string, client?: string | null): Promise<void> {
  const qs = `?paymentId=${encodeURIComponent(paymentId)}${client ? `&client=${encodeURIComponent(client)}` : ''}`
  const res = await fetch(`${BASE}/sessions${qs}`, { method: 'DELETE' })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `revoke ${res.status}`)
}

export type JobAction = 'complete' | 'reject' | 'claimRefund' | 'submit'

// Must match jobActionMessage in src/lib/jobs.ts. It binds the action to one job
// and one address so the server cannot be replayed against a different job or action.
export function jobActionMessage(input: {
  jobId: string
  action: JobAction
  address: string
  reason?: string
  deliverable?: string
}): string {
  return [
    'Agent Souk job action',
    `jobId: ${input.jobId}`,
    `action: ${input.action}`,
    `address: ${input.address.toLowerCase()}`,
    `reason: ${input.reason ?? ''}`,
    `deliverable: ${input.deliverable ?? ''}`,
  ].join('\n')
}

export async function actOnJob(
  jobId: string,
  action: JobAction,
  body: { by?: string; reason?: string; deliverable?: string } = {},
): Promise<Erc8183Job> {
  const address = body.by ?? (await getActiveAccount())
  if (!address) throw new Error('Connect a wallet to act on this job.')

  const message = jobActionMessage({
    jobId,
    action,
    address,
    reason: body.reason,
    deliverable: body.deliverable,
  })
  const provider = await getProvider()
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string

  const res = await fetch(`${BASE}/jobs/${jobId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      by: address,
      reason: body.reason,
      deliverable: body.deliverable,
      signature,
    }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.job) throw new Error(payload?.error ?? `job ${res.status}`)
  return payload.job as Erc8183Job
}

export async function getBoostStatus(chainId: number, tokenId: string): Promise<{
  eligible: boolean
  checks: { key: string; label: string; ok: boolean; detail?: string }[]
  missing: string[]
  owners: string[]
  boost: { expiresAt: string; days: number } | null
}> {
  const res = await fetch(
    `${BASE}/boosts?chainId=${chainId}&tokenId=${encodeURIComponent(tokenId)}`,
  )
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.error ?? `boost status ${res.status}`)
  }
  return {
    eligible: Boolean(payload.eligible),
    checks: payload.checks ?? [],
    missing: payload.missing ?? [],
    owners: payload.owners ?? [],
    boost: payload.boost ?? null,
  }
}

export async function activateBoost(body: {
  chainId: number
  tokenId: string
  days?: number
  paymentId?: string
  contact?: string
  owner?: string
  signature?: string
  nonce?: string
}): Promise<{ expiresAt: string; days: number }> {
  const res = await fetch(`${BASE}/boosts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) {
    const extra =
      Array.isArray(payload?.missing) && payload.missing.length
        ? ` Missing: ${payload.missing.join(', ')}.`
        : ''
    throw new Error((payload?.error ?? `boost ${res.status}`) + extra)
  }
  return {
    expiresAt: payload.boost.expiresAt as string,
    days: payload.boost.days as number,
  }
}