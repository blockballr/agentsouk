import type { ActiveHireSession, Erc8183Job, EscrowStatus, HireTask, OngoingBundle } from './api'

// one plain state per hire, so the page says what happened and what the buyer does
// next instead of stacking the session, job and task statuses side by side

export type HireGroup = 'needs' | 'progress' | 'finished'
export type HireAction = 'complete' | 'retry' | 'run'

export interface HireState {
  group: HireGroup
  label: string
  note?: string
  action?: HireAction
}

export interface HireItem {
  key: string
  chainId: number
  tokenId: string
  agentName: string
  session: ActiveHireSession | null
  task: HireTask | null
  job: Erc8183Job | null
  // the payment's on-chain escrow state when one exists, so the card never
  // reads as paid out while the funder still holds the money
  escrow?: EscrowStatus | null
  // the session has not expired, so it can still be drawn on and must stay revocable,
  // whatever its job says: delivery checks the receipt, not the job
  live: boolean
  at: string
}

// read in the order a buyer has to act: an attestation waits on them first,
// then a terminal job, then the run itself
export function hireState(item: HireItem): HireState {
  const { task, job, live, escrow } = item
  // the money's state belongs to the escrow, not the job: a finished job whose
  // payment is still held says so instead of reading as paid out
  const held = escrow?.status === 0
  const refundable = Boolean(held && escrow?.verifiedAt === 0)
  if (job?.status === 'Submitted') {
    return {
      group: 'needs',
      label: 'Delivered, waiting for your OK',
      note: 'Check the result, then complete the job or reject it.',
      action: 'complete',
    }
  }
  if (job?.status === 'Completed') {
    return held
      ? { group: 'finished', label: 'Completed', note: 'Your payment releases from escrow once the dispute window passes.' }
      : { group: 'finished', label: 'Completed' }
  }
  if (job?.status === 'Rejected') {
    return held
      ? { group: 'finished', label: 'Rejected', note: 'Your payment has not left the escrow.' }
      : { group: 'finished', label: 'Rejected' }
  }
  if (job?.status === 'Expired') {
    if (!held) return { group: 'finished', label: 'Expired' }
    return refundable
      ? { group: 'finished', label: 'Expired', note: 'Your payment is still held in escrow - take the refund.' }
      : { group: 'finished', label: 'Expired', note: 'Your payment has not left the escrow.' }
  }
  // a retry replays the paid call, which the server allows after the session ends
  if (task?.status === 'failed') {
    return task.attempts < task.maxAttempts
      ? { group: 'needs', label: 'Delivery failed', note: 'Retry it, or open the agent and send the task again.', action: 'retry' }
      : { group: 'finished', label: 'Delivery failed', note: 'No retries left.' }
  }
  if (task?.status === 'running') return { group: 'progress', label: 'Agent is working' }
  if (task?.status === 'delivered') return { group: 'finished', label: 'Delivered' }
  if (task?.status === 'gated') {
    return { group: 'finished', label: 'Agent refused the call', note: 'It answers only through its own access gate.' }
  }
  if (live) {
    return held
      ? {
          group: 'needs',
          label: 'Paid, held in escrow',
          note: 'Open the agent and send it a task. Your payment is held until you OK the delivery.',
          action: 'run',
        }
      : { group: 'needs', label: 'Paid, ready to run', note: 'Open the agent and send it a task.', action: 'run' }
  }
  if (refundable) return { group: 'finished', label: 'Ended unused', note: 'Your payment is still held in escrow - take the refund.' }
  if (held) return { group: 'finished', label: 'Ended unused', note: 'Your payment has not left the escrow.' }
  return { group: 'finished', label: 'Ended unused' }
}

// what the escrow line on a hire card says, following the money: held until a
// verified delivery and the dispute window, then released or refunded
export interface EscrowChip {
  text: string
  tone: 'hold' | 'ready' | 'done'
}

export function escrowChip(escrow: EscrowStatus | null | undefined, now: number = Date.now()): EscrowChip | null {
  if (!escrow) return null
  if (escrow.status === 1) return { text: 'Released to the agent', tone: 'done' }
  if (escrow.status === 2) return { text: 'Refunded to your wallet', tone: 'done' }
  if (escrow.verifiedAt === 0) return { text: 'Held in escrow, waiting on delivery', tone: 'hold' }
  if (escrow.windowEndsAt !== null && escrow.windowEndsAt * 1000 <= now) {
    return { text: 'Ready to release from escrow', tone: 'ready' }
  }
  return { text: 'Held in escrow, dispute window open', tone: 'hold' }
}

// sessions and ended-session tasks as one list, one entry per payment, newest first
export function hireItems(bundle: OngoingBundle | null, now: number = Date.now()): HireItem[] {
  if (!bundle) return []
  const byPayment = new Map<string, HireItem>()
  for (const { session, task, job } of bundle.sessions) {
    const open = new Date(session.expiresAt).getTime() > now
    byPayment.set(session.paymentId, {
      key: session.paymentId,
      chainId: session.chainId,
      tokenId: session.tokenId,
      agentName: session.agentName,
      session,
      task,
      job,
      live: open,
      at: task?.updatedAt ?? session.createdAt,
    })
  }
  for (const { task, session, job } of bundle.recentTasks) {
    if (byPayment.has(task.paymentId)) continue
    byPayment.set(task.paymentId, {
      key: task.paymentId,
      chainId: task.chainId,
      tokenId: task.tokenId,
      agentName: task.agentName,
      session,
      task,
      job,
      live: false,
      at: task.updatedAt,
    })
  }
  return [...byPayment.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export type ReadableResult = { kind: 'fields'; fields: [string, string][]; more: number } | { kind: 'text'; text: string }

// a deliverable is often a JSON object; a buyer reads labelled values, not braces
export function readableResult(text: string): ReadableResult {
  let value: unknown
  try {
    value = JSON.parse(text.trim())
  } catch {
    return { kind: 'text', text }
  }
  // A2A and MCP wrappers carry the real payload one or two levels down
  for (let i = 0; i < 2 && isPlainObject(value); i++) {
    const keys = Object.keys(value)
    const inner = keys.length === 1 ? value[keys[0]] : isPlainObject(value.data) && keys.includes('kind') ? value.data : undefined
    if (isPlainObject(inner)) value = inner
    else break
  }
  if (!isPlainObject(value)) return { kind: 'text', text: typeof value === 'string' ? value : text }
  const entries = Object.entries(value)
  const fields = entries.slice(0, 8).map(([k, v]) => [labelFor(k), valueText(v)] as [string, string])
  return { kind: 'fields', fields, more: Math.max(0, entries.length - 8) }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return 'none'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.map((x) => String(x)).join(', ')
    return `${v.length} item${v.length === 1 ? '' : 's'}`
  }
  const json = JSON.stringify(v)
  return json.length > 80 ? `${json.slice(0, 80)}…` : json
}
