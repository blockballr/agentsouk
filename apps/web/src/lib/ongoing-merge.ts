import type { ActiveHireSession, OngoingBundle, WalletHire } from './api'

export type SessionEntry = OngoingBundle['sessions'][number]

// The wallet hire endpoint reports mode as a free string; only the two paid modes
// are trusted, anything else (including absent) takes the sandbox label the card
// already renders as its default.
function asMode(mode: string | undefined): ActiveHireSession['mode'] {
  return mode === 'b402' || mode === 'prod' ? mode : 'sandbox'
}

// An absent or unparseable createdAt sorts last rather than dropping the card.
function createdTime(session: ActiveHireSession): number {
  if (!session.createdAt) return 0
  const ms = new Date(session.createdAt).getTime()
  return Number.isFinite(ms) ? ms : 0
}

// Live while the server has not reported an expiry in the past. An absent or
// unparseable expiry keeps the hire: the page must not hide what it cannot date.
function isLive(hire: WalletHire, now: number): boolean {
  if (!hire.expiresAt) return true
  const ms = new Date(hire.expiresAt).getTime()
  if (!Number.isFinite(ms)) return true
  return ms > now
}

function sessionFromHire(hire: WalletHire): ActiveHireSession {
  return {
    paymentId: hire.paymentId,
    chainId: hire.chainId,
    tokenId: hire.tokenId,
    agentName: hire.agentName ?? 'Unknown agent',
    client: hire.client ?? '',
    spendCapUsd: typeof hire.spendCapUsd === 'number' ? hire.spendCapUsd : 0,
    expiresAt: hire.expiresAt ?? '',
    mode: asMode(hire.mode),
    createdAt: hire.createdAt ?? '',
  }
}

function newer<T extends { updatedAt: string }>(before: T | null, after: T | null): T | null {
  if (!before) return after
  if (!after) return before
  return after.updatedAt >= before.updatedAt ? after : before
}

// consecutive polls can be answered by instances that disagree, so a poll that
// comes back without a hire's task or job, or with an older copy, must not undo
// what the page already shows: the newer record wins and an absent one keeps the last
// a session the new poll no longer lists is dropped, so a revoke still leaves at once
export function stabiliseSessions(previous: SessionEntry[] | null | undefined, next: SessionEntry[]): SessionEntry[] {
  if (!previous?.length) return next
  const before = new Map(previous.map((entry) => [entry.session.paymentId, entry]))
  return next.map((entry) => {
    const prior = before.get(entry.session.paymentId)
    if (!prior) return entry
    return { ...entry, task: newer(prior.task, entry.task), job: newer(prior.job, entry.job) }
  })
}

// Merge the instance's own ledger with the wallet's durable hires, keyed by
// payment id. The bundle wins a collision because only it carries the task and
// job; the wallet list fills the gap left by an instance that never settled the
// session, so the live list is complete no matter which instance answers.
export function mergeSessions(
  bundleSessions: SessionEntry[],
  walletHires: WalletHire[],
  now: number = Date.now(),
): SessionEntry[] {
  const merged = new Map<string, SessionEntry>()
  for (const entry of bundleSessions) merged.set(entry.session.paymentId, entry)
  for (const hire of walletHires) {
    if (merged.has(hire.paymentId)) continue
    if (!isLive(hire, now)) continue
    merged.set(hire.paymentId, { session: sessionFromHire(hire), task: null, job: null })
  }
  return [...merged.values()].sort((a, b) => {
    const byNewest = createdTime(b.session) - createdTime(a.session)
    return byNewest !== 0 ? byNewest : a.session.paymentId.localeCompare(b.session.paymentId)
  })
}
