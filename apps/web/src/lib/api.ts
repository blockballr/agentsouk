import type { AgentDetail, AgentSummary } from '../core/types'
import type { PaymentRequirements, PreviewResult, Receipt, SettleResult } from '../core/x402'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
import { getProvider, setTargetChain } from './wallet'
import { sessionAccount } from './wallet-session'
import { listingControlMessage, type ListingAction } from './listing-control'

export interface AgentsQuery {
  category?: string
  q?: string
  type?: 'all' | 'jobs' | 'x402' | 'vault' | 'others'
  metric?: 'score' | 'newest' | 'feedback' | 'health'
  page?: number
  limit?: number
  pcs?: boolean
  // the visit's rotation seed, which orders the working agents under "Working first"
  seed?: string
}

export interface AgentsResult {
  items: AgentSummary[]
  total: number
  // agents held in the committed snapshot
  snapshotTotal: number | null
  // agents the catalogue actually serves on this chain: the committed snapshot
  // plus anything the shared store has added, minus the ones the sweeps removed
  shelved: number | null
  // agents the registry reports for the served chain, null when the snapshot
  // never recorded one
  registryTotal: number | null
  // provenance the server can attest: when the snapshot was taken, and when the
  // process last topped it up from the registry (null until a live refresh lands)
  snapshotTime: string | null
  lastTopUpAt: number | null
  counts: Record<string, number>
  chainId: number | null
  // the catalogue's own state, from the shared store rather than the committed file
  indexStatus: IndexStatus
}

// The catalogue's own state, reported by the server from the shared store rather
// than from the committed file.
export interface IndexStatus {
  catalogueRefreshedAt: string | null
  // the chain head when the catalogue record was written
  catalogueBlock: number | null
  // "store" when the shared store holds this chain's rows, "unavailable" when
  // the store is empty and the registry did not answer
  catalogueSource: 'store' | 'snapshot' | 'unavailable'
}

// warm the detail route while the pointer is on the card, so the click lands on
// a response the function has already built instead of a cold start
export function prefetchAgent(chainId: number | string, tokenId: string): void {
  void fetch(`${BASE}/agents/${chainId}/${tokenId}`, { headers: { accept: 'application/json' } }).catch(() => {})
}

export async function getAgents(query: AgentsQuery = {}): Promise<AgentsResult> {
  const sp = new URLSearchParams()
  if (query.category && query.category !== 'all') sp.set('category', query.category)
  if (query.q) sp.set('q', query.q)
  if (query.type) sp.set('type', query.type)
  if (query.metric) sp.set('metric', query.metric)
  if (query.page && query.page > 1) sp.set('page', String(query.page))
  if (query.limit) sp.set('limit', String(query.limit))
  if (query.pcs) sp.set('pcs', '1')
  const res = await fetch(`${BASE}/agents?${sp}`)
  if (!res.ok) throw new Error(`agents ${res.status}`)
  const body = await readJsonBody<{
    items?: AgentSummary[]
    total?: number
    snapshotTotal?: number | null
    shelved?: number | null
    registryTotal?: number | null
    snapshotTime?: string | null
    lastTopUpAt?: number | null
    counts?: Record<string, number>
    chainId?: number
    indexStatus?: {
      catalogueRefreshedAt?: string | null
      catalogueSource?: string
      catalogueBlock?: number | null
    }
  }>(res, 'agents')
  const items: AgentSummary[] = body.items ?? []
  // the server states the chain it serves; fall back to the catalogue only when the
  // field is absent, and never trust a non-positive or non-finite value
  const chain = body.chainId ?? items[0]?.chain_id
  const chainId = typeof chain === 'number' && Number.isFinite(chain) && chain > 0 ? chain : null
  if (chainId !== null) setTargetChain(chainId)
  // only the store can attest a refresh time; an absent or malformed value stays
  // null so the page never presents a made-up freshness figure
  const indexStatus: IndexStatus = {
    catalogueRefreshedAt:
      typeof body.indexStatus?.catalogueRefreshedAt === 'string'
        ? body.indexStatus.catalogueRefreshedAt
        : null,
    catalogueSource:
      body.indexStatus?.catalogueSource === 'store'
        ? 'store'
        : body.indexStatus?.catalogueSource === 'unavailable'
          ? 'unavailable'
          : 'snapshot',
    catalogueBlock:
      typeof body.indexStatus?.catalogueBlock === 'number'
        ? body.indexStatus.catalogueBlock
        : null,
  }
  return {
    items,
    total: body.total ?? 0,
    snapshotTotal: body.snapshotTotal ?? null,
    shelved:
      typeof body.shelved === 'number' && Number.isFinite(body.shelved)
        ? body.shelved
        : null,
    registryTotal: body.registryTotal ?? null,
    snapshotTime: typeof body.snapshotTime === 'string' ? body.snapshotTime : null,
    lastTopUpAt:
      typeof body.lastTopUpAt === 'number' && Number.isFinite(body.lastTopUpAt)
        ? body.lastTopUpAt
        : null,
    counts: body.counts ?? {},
    chainId,
    indexStatus,
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

// An impression is one open of a listing page. The call is fire-and-forget and
// keepalive so a reader who leaves immediately still counts, and the server
// dedupes a reader to one an hour.
export function recordAgentView(chainId: number, tokenId: string): void {
  void fetch(`${BASE}/agents/views`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainId, tokenId }),
    keepalive: true,
  }).catch(() => {})
}

// The seller board's own counts. An unreadable count is an empty one, because a
// missing figure must never read as zero attention.
export async function getListingViews(
  chainId: number,
  tokens: string[],
  days = 14,
): Promise<Record<string, number>> {
  if (tokens.length === 0) return {}
  const query = new URLSearchParams({
    chainId: String(chainId),
    tokens: tokens.slice(0, 50).join(','),
    days: String(days),
  })
  const res = await fetch(`${BASE}/agents/views?${query}`)
  if (!res.ok) return {}
  const body = await readJsonBody<{ counts?: Record<string, number> }>(res, 'views')
  return body.counts ?? {}
}

export interface FreePreviewResult {
  text: string
  skillId?: string
  skillName?: string
}

// Runs an agent's own advertised skill with no buyer input, through the
// marketplace, so a third-party endpoint does not need to allow the browser.
export async function runFreePreview(endpoint: string, skillId?: string): Promise<FreePreviewResult> {
  const res = await fetch(`${BASE}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, skillId }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) {
    throw new Error(payload?.error ?? `preview ${res.status}`)
  }
  return {
    text: payload.data?.text ?? '',
    skillId: payload.data?.skillId,
    skillName: payload.data?.skillName,
  }
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

// the marketplace's own sentence for why a hire was not offered, safe to show as it is
export class HireRefusedError extends Error {}

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
  if (!res.ok) {
    // a refusal carries its own sentence, which is what the buyer should read
    const refusal =
      res.status === 409
        ? await res
            .json()
            .then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : null))
            .catch(() => null)
        : null
    if (refusal) throw new HireRefusedError(refusal.slice(0, 400))
    throw new Error(`requirements ${res.status}`)
  }
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

export interface AgentCardSkill {
  id?: string
  name?: string
  description?: string
  examples?: string[]
  inputSchema?: {
    type?: string
    properties?: Record<string, { type?: string; description?: string }>
    required?: string[]
    // the skill's own worked input, which drives a preview when it has one
    examples?: Record<string, unknown>[]
  }
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
  skills?: AgentCardSkill[]
}

export interface DeliverBody {
  paymentId: string
  tool?: string
  args?: Record<string, unknown>
  task?: string
  input?: Record<string, unknown>
  wallet?: string
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
  const wallet = body.wallet ?? (await sessionAccount().catch(() => null))
  const enriched = wallet ? { ...body, wallet } : body
  const res = await fetch(`${BASE}/x402/deliver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(enriched),
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

export interface VaultAgentLink {
  tokenId: string
  wallet: string
  category: string | null
  policy: string | null
  vaultOnly: boolean
  name: string | null
}

// the first-party vault agents on a chain, for the sibling links a vault agent's
// page carries. the API answers with the registry's names, never a local copy
export async function getVaultAgents(chainId: number): Promise<VaultAgentLink[]> {
  const res = await fetch(`${BASE}/vault/agents?chain=${chainId}`)
  if (!res.ok) return []
  const body = await readJsonBody<{ agents?: VaultAgentLink[] }>(res, 'vault agents')
  return Array.isArray(body.agents) ? body.agents : []
}

export async function getTasksByPayment(paymentId: string): Promise<HireTask[]> {
  const res = await fetch(`${BASE}/tasks?paymentId=${encodeURIComponent(paymentId)}`)
  if (!res.ok) return []
  const body = await readJsonBody<{ tasks?: HireTask[] }>(res, 'tasks')
  return body.tasks ?? []
}

// the job behind one hire, so a reload finds the run pane's state instead of
// offering an empty panel for work that already settled
export async function getJobByPayment(paymentId: string): Promise<Erc8183Job | null> {
  const res = await fetch(`${BASE}/jobs?paymentId=${encodeURIComponent(paymentId)}`)
  if (!res.ok) return null
  const body = await readJsonBody<{ jobs?: Erc8183Job[] }>(res, 'jobs')
  return body.jobs?.[0] ?? null
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
  // absent when the instance ledger could not answer and the page is running on
  // the wallet's durable hires alone
  counts?: {
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

// A cold instance can leave the per instance ledger unresponsive for a minute or
// more. The wallet's durable hires carry the page, so this call is bounded: a slow
// answer must not hold the live sessions off the screen.
export async function getOngoing(
  client?: string | null,
  timeoutMs = 10000,
): Promise<OngoingBundle> {
  const qs = client ? `?client=${encodeURIComponent(client)}` : ''
  const controller = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  let res: Response
  try {
    res = await fetch(`${BASE}/sessions${qs}`, { signal: controller.signal })
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`sessions timed out after ${timeoutMs}ms`)
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
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

// the on-chain escrow state of one settled hire, as the status route reports
// it: the funder holds the money at status 0 until release (1) or refund (2)
export interface EscrowStatus {
  paymentId: string
  buyer: string
  payTo: string
  amount: string
  status: number
  fundedAt: number
  verifiedAt: number
  windowEndsAt: number | null
}

// one batched read for every payment on the page. An older deploy has no such
// route, and a hire card must survive that: no answer reads as no escrow line
// rather than as an error
export async function getEscrowStatuses(
  paymentIds: string[],
): Promise<{ funder: string | null; byId: Record<string, EscrowStatus> }> {
  if (paymentIds.length === 0) return { funder: null, byId: {} }
  const res = await fetch(`${BASE}/escrow?paymentIds=${encodeURIComponent(paymentIds.join(','))}`)
  if (!res.ok) return { funder: null, byId: {} }
  const body = await readJsonBody<{ funder?: string | null; jobs?: EscrowStatus[] }>(res, 'escrow')
  const byId: Record<string, EscrowStatus> = {}
  for (const job of body.jobs ?? []) byId[job.paymentId] = job
  return { funder: body.funder ?? null, byId }
}

export async function revokeSession(paymentId: string, client?: string | null): Promise<void> {
  const qs = `?paymentId=${encodeURIComponent(paymentId)}${client ? `&client=${encodeURIComponent(client)}` : ''}`
  const res = await fetch(`${BASE}/sessions${qs}`, { method: 'DELETE' })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `revoke ${res.status}`)
}

export interface AgentVerification {
  status: 'delivered' | 'gated' | 'dead' | 'unreachable'
  checkedAt: string
  responseMs: number
  quality?: { grade: 'good' | 'partial' | 'poor'; reason: string; model: string }
  concurrency?: 'parallel-ok' | 'single-ok' | 'untested'
  detail?: string
}

export interface OwnedAgent {
  chainId: number
  tokenId: string
  agentId: string
  name: string
  description: string | null
  category: string
  contractAddress: string
  ownerAddress: string
  // the listing's receiving wallet; null when the detail read could not name one
  agentWallet: string | null
  isVerified: boolean
  isActive: boolean
  x402Supported: boolean
  healthScore: number | null
  createdAt: string
  verification: AgentVerification | null
  failingSince?: string | null
  // off the market, by the owner ("owner delist") or by the daily sweep ("auto-stale")
  delisted?: { reason: string | null; at: string | null } | null
}

export interface OwnedAgentsResult {
  agents: OwnedAgent[]
  chainId: number | null
  counts: { agents: number; categories: Record<string, number> }
}

// The listings a wallet owns, read from the registry's owner index. Each row carries
// the verifier's badge so the profile can show whether the endpoint answered.
export async function getAgentsByOwner(owner: string): Promise<OwnedAgentsResult> {
  const res = await fetch(`${BASE}/agents/by-owner?owner=${encodeURIComponent(owner)}`)
  if (!res.ok) throw new Error(`owned agents ${res.status}`)
  const body = await readJsonBody<{
    agents?: OwnedAgent[]
    chainId?: number
    counts?: { agents?: number; categories?: Record<string, number> }
  }>(res, 'owned agents')
  // an older deploy may not carry the payee column yet; normalize it so the
  // seller board reads one shape whether or not the API has caught up
  const agents = (body.agents ?? []).map((a) => ({ ...a, agentWallet: a.agentWallet ?? null }))
  const chain = body.chainId ?? agents[0]?.chainId
  const chainId = typeof chain === 'number' && Number.isFinite(chain) && chain > 0 ? chain : null
  return {
    agents,
    chainId,
    counts: {
      agents: body.counts?.agents ?? agents.length,
      categories: body.counts?.categories ?? {},
    },
  }
}

// Must match recheckMessage in src/app/api/agents/[chainId]/[tokenId]/verify/route.ts.
// It binds the probe to one token and one owner, so a signature cannot be replayed
// against a different listing.
export function recheckMessage(chainId: number, tokenId: string, owner: string): string {
  return [
    'Agent Souk re-check',
    `chainId: ${chainId}`,
    `tokenId: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
  ].join('\n')
}

export interface RecheckResult {
  // true when the twenty hour window still held and nothing new was probed
  skipped: boolean
  // true when an owner signature bypassed that window
  forced: boolean
  verification: AgentVerification | null
}

// Force a fresh probe of one owned listing. The owner signs, so the reprobe
// window is bypassed for this token only; anyone else keeps the twenty hour cap.
export async function recheckAgent(chainId: number, tokenId: string): Promise<RecheckResult> {
  const owner = await sessionAccount()
  if (!owner) throw new Error('Connect the wallet that owns this listing.')
  const message = recheckMessage(chainId, tokenId, owner)
  const provider = await getProvider()
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, owner],
  })) as string
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true, owner, signature }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error ?? `re-check ${res.status}`)
  return {
    skipped: Boolean(payload?.skipped),
    forced: Boolean(payload?.forced),
    verification: (payload?.verification ?? null) as AgentVerification | null,
  }
}

// Take an owned listing off the market or put it back. The owner signs a message bound
// to this token and action; the on-chain registration is untouched either way.
export async function setListingState(chainId: number, tokenId: string, action: ListingAction): Promise<void> {
  const owner = await sessionAccount()
  if (!owner) throw new Error('Connect the wallet that owns this listing.')
  const message = listingControlMessage(chainId, tokenId, owner, action)
  const provider = await getProvider()
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [message, owner],
  })) as string
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}/delist`, {
    method: action === 'delist' ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owner, signature }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) throw new Error(payload?.error ?? `${action} ${res.status}`)
}

export interface PayeeHire {
  paymentId: string
  chainId: number
  tokenId: string
  agentName: string
  client: string
  payTo: string
  txHash: string | null
  mode: 'sandbox' | 'prod' | 'b402'
  amount: string
  symbol: string
  // decimals of the settlement asset, or null when the chain is unconfigured
  decimals: number | null
  // who paid, as the server reads it: a verifier probe, the lister's own wallet, a team wallet, or a buyer
  payer?: 'check' | 'self' | 'team' | 'buyer'
  active: boolean
  createdAt: string
}

export interface HiresByPayeeResult {
  hires: PayeeHire[]
  counts: { hires: number }
  source: 'postgres' | 'memory'
}

// A wallet's own hires, read from the receipts store rather than any instance's
// ledger, so a live session is found even when another instance settled it.
export interface WalletHire {
  paymentId: string
  chainId: number
  tokenId: string
  agentName?: string
  client?: string
  mode?: string
  spendCapUsd?: number
  createdAt?: string
  expiresAt?: string
}

export async function getHiresByWallet(wallet: string): Promise<WalletHire[]> {
  const res = await fetch(`${BASE}/hires/by-wallet?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return []
  const body = await readJsonBody<{ hires?: WalletHire[] }>(res, 'hires')
  return body.hires ?? []
}

// The pairing a deposit-hire link checks: the wallet the executor trades
// from. None when the route reports no lane; a non-ok answer throws so the
// caller can say the pairing could not be read rather than calling it absent.
export interface WalletActivity {
  available: boolean
  wallet: string
  chainId: number
  actions: number
  days: number
  lastAt: string | null
  qualified: boolean
  reason?: string
}

// The agent's own wallet, read against the chain. Unavailable is said plainly
// rather than shown as zero, so a missing explorer key never reads as an agent
// that has never acted.
export async function getAgentActivity(
  chainId: string,
  tokenId: string,
): Promise<WalletActivity | null> {
  const res = await fetch(`${BASE}/agents/${chainId}/${tokenId}/activity`)
  if (!res.ok) return null
  const body = await readJsonBody<{ success?: boolean; activity?: WalletActivity }>(res, 'activity')
  return body.activity ?? null
}

export async function getVaultExecutor(): Promise<{ kind: 'rawkey' | 'altana'; address: string; executors?: string[] } | null> {
  const res = await fetch(`${BASE}/vault/executor`)
  if (!res.ok) throw new Error(`Vault executor answered ${res.status}.`)
  const body = await readJsonBody<{ executor?: { kind: 'rawkey' | 'altana'; address: string } | null; executors?: string[] }>(res, 'vault executor')
  if (!body.executor) return null
  return { ...body.executor, executors: body.executors ?? [body.executor.address] }
}

// The buyer's on-ramp for an ERC-8183 job: the validated quote and the stack
// the buyer's wallet will fund against, from the negotiate route. The refusal
// keeps its reason; the route's guards explain most refusals themselves.
export async function getJobs8183Quote(input: {
  tokenId: string
  task: string
  client: string
  chainId?: number
}): Promise<
  | {
      ok: true
      quote: {
        price: string
        currency: string
        providerAddress: string
        validUntil: number
        negotiationHash: string
        providerSig: string
        agentId: string | null
        envelope?: Record<string, unknown>
      }
      stack: { commerce: string; router: string; policy: string; paymentToken: string }
    }
  | { ok: false; error: string; transient?: boolean }
> {
  let res: Response
  try {
    res = await fetch(`${BASE}/jobs8183/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch {
    return { ok: false, error: 'the quoting route could not be reached', transient: true } as const
  }
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; error?: string; quote?: Jobs8183QuotePayload; stack?: Jobs8183StackShape }
    | null
  if (!res.ok || !body?.success) {
    const reason = body?.error
    if (typeof reason === 'string' && reason) {
      // the route's one answer for an endpoint that never answered; every other
      // refusal is the seller's or a guard's and comes back identical on a retry
      const transient = reason.includes('did not answer the negotiate call')
      return { ok: false, error: reason, ...(transient ? { transient: true } : {}) } as const
    }
    // no reason in the body means a crash or an html error page, not an answer
    return { ok: false, error: `the quoting route refused (${res.status})`, transient: true } as const
  }
  return { ok: true, quote: body.quote as Jobs8183QuotePayload, stack: body.stack as Jobs8183StackShape } as const
}

type Jobs8183QuotePayload = {
  price: string
  currency: string
  providerAddress: string
  validUntil: number
  negotiationHash: string
  providerSig: string
  agentId: string | null
  envelope?: Record<string, unknown>
}

type Jobs8183StackShape = { commerce: string; router: string; policy: string; paymentToken: string }

// The post-fund step: the buyer reports the funded kernel job. The server
// verifies the chain's own answer before recording, then notifies the seller
// and returns what the seller actually said.
export async function recordJobs8183Job(input: {
  tokenId: string
  kernelJobId: bigint | string
  client: string
  chainId?: number
}): Promise<
  | { ok: true; recorded: { id: string; onchainJobId: number; agent: string; status: string }; notify: { ok: boolean; reply: string } }
  | { ok: false; error: string }
> {
  const res = await fetch(`${BASE}/jobs8183/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, kernelJobId: String(input.kernelJobId) }),
  })
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; error?: string; recorded?: { id: string; onchainJobId: number; agent: string; status: string }; notify?: { ok: boolean; reply: string } }
    | null
  if (!res.ok || !body?.success) return { ok: false, error: body?.error ?? `the record route refused (${res.status})` } as const
  return { ok: true, recorded: body.recorded as never, notify: body.notify as never } as const
}

// The wallet's recorded kernel jobs, status re-read from the kernel per row
export interface Jobs8183Result {
  content: string | null
  contentType: string | null
  url: string | null
}

export interface Jobs8183Row {
  id: string
  onchainJobId: number
  chainId: number
  tokenId: string
  agentName: string
  budgetUsd: number
  expiredAt: string
  status: number | null
  submittedAt: string | null
  result: Jobs8183Result | null
  updatedAt: string
}

// The notification outbox as the bell reads it. Rows are newest-first from the
// route; unread drives the badge.
export interface NotificationRow {
  id: string
  kind: string
  title: string
  body: string
  href?: string
  txHash?: string
  read?: boolean
  createdAt: string
}

export async function getNotifications(wallet: string): Promise<{ rows: NotificationRow[]; unread: number }> {
  const res = await fetch(`${BASE}/notifications?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return { rows: [], unread: 0 }
  const body = (await res.json().catch(() => null)) as { notifications?: NotificationRow[]; unread?: number } | null
  return { rows: body?.notifications ?? [], unread: body?.unread ?? 0 }
}

export async function markNotificationsRead(wallet: string, id?: string): Promise<void> {
  await fetch(`${BASE}/notifications`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, ...(id ? { id } : {}) }),
  }).catch(() => {})
}

export async function getJobs8183Jobs(wallet: string): Promise<Jobs8183Row[]> {
  const res = await fetch(`${BASE}/jobs8183/jobs?wallet=${encodeURIComponent(wallet)}`)
  if (!res.ok) return []
  const body = (await res.json().catch(() => null)) as { jobs?: Jobs8183Row[] } | null
  return body?.jobs ?? []
}

// Read a single funded job straight off the chain, without a wallet, so a job
// that lost its marketplace record can still be recovered by its on-chain id.
export async function getJobs8183Job(chainId: number, jobId: number): Promise<Jobs8183Row | null> {
  const res = await fetch(`${BASE}/jobs8183/jobs?chainId=${chainId}&jobId=${jobId}`)
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { jobs?: Jobs8183Row[] } | null
  return body?.jobs?.[0] ?? null
}

// Hires paid to a wallet's agents. The payee is the agent's receiving wallet.
export async function getHiresByPayee(payee: string): Promise<HiresByPayeeResult> {
  const res = await fetch(`${BASE}/hires/by-payee?payee=${encodeURIComponent(payee)}`)
  if (!res.ok) throw new Error(`received hires ${res.status}`)
  const body = await readJsonBody<{
    hires?: PayeeHire[]
    counts?: { hires?: number }
    source?: 'postgres' | 'memory'
  }>(res, 'received hires')
  const hires = body.hires ?? []
  return {
    hires,
    counts: { hires: body.counts?.hires ?? hires.length },
    source: body.source === 'postgres' ? 'postgres' : 'memory',
  }
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
  const address = body.by ?? (await sessionAccount())
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
// verifies a Turnstile token against the API, which holds the secret. The
// security gate uses this before it lets a new session into the app.
export async function verifyTurnstile(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/verify-turnstile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const payload = await res.json().catch(() => null)
  return Boolean(payload?.success)
}

export interface EscrowRating {
  id: string
  chainId: number
  tokenId: string
  paymentId: string
  rater: string
  score: number
  comment: string
  verifierScore: number
  createdAt: string
}

export interface EscrowRatingSummary {
  count: number
  average: number
  verifierAverage: number
}

export async function getRatings(chainId: number, tokenId: string): Promise<{ ratings: EscrowRating[]; summary: EscrowRatingSummary }> {
  const res = await fetch(`${BASE}/ratings?chainId=${chainId}&tokenId=${encodeURIComponent(tokenId)}`)
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) throw new Error(payload?.error ?? `ratings ${res.status}`)
  return { ratings: payload.ratings ?? [], summary: payload.summary ?? { count: 0, average: 0, verifierAverage: 0 } }
}

export async function submitEscrowRating(input: {
  chainId: number
  tokenId: string
  paymentId: string
  score: number
  comment: string
  verifierScore: number
  rater: string
  signature: string
}): Promise<{ rating: EscrowRating; summary: EscrowRatingSummary }> {
  const res = await fetch(`${BASE}/ratings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) throw new Error(payload?.error ?? `rating ${res.status}`)
  return { rating: payload.rating, summary: payload.summary }
}

// the market's own recent settlements, for the shelf's evidence band
export interface RecentHire {
  at: string
  agentName: string
  tokenId: string
  chainId: number
  rail: string
  amount: string
  symbol: string
  txHash: string | null
}

export async function getRecentHires(limit = 6): Promise<RecentHire[]> {
  const res = await fetch(`${BASE}/hires/recent?limit=${limit}`)
  if (!res.ok) throw new Error(`recent hires ${res.status}`)
  const body = (await res.json()) as { items?: RecentHire[] }
  return body.items ?? []
}