// the team station's client: one nonce, one signature, one bearer session. Every
// message below is re-verified byte for byte by the server, so the text has to
// match src/lib/station.ts exactly.

import { getActiveAccount, getProvider } from './wallet'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const SITE = 'station.agentsouk.xyz'

export type StationRole = 'viewer' | 'operator' | 'owner'

export interface StationMember {
  address: string
  role: StationRole
  addedBy: string | null
  addedAt: string
}

export interface AuditEntry {
  at: string
  actor: string
  action: string
  detail: string | null
}

export interface StationSession {
  token: string
  address: string
  role: StationRole
  expiresAt: string
}

export interface StationOverview {
  generatedAt: string
  [key: string]: unknown
}

export interface StationOperations {
  generatedAt: string
  chainId: number
  settlement: string
  jobs: { name: string; startedAt: string | null; finishedAt: string | null; ok: boolean | null; note: string | null }[]
  relay: { address: string | null; balance: string | null; note: string | null }
  stores: { name: string; mode: string; durable: boolean }[]
}

// mirrors stationSignInMessage in src/lib/station.ts. The server returns the exact
// text to sign, so this is only here to check the two never drift apart.
export function signInMessage(address: string, nonce: string): string {
  return ['Agent Souk station sign-in', `site: ${SITE}`, `address: ${address.toLowerCase()}`, `nonce: ${nonce}`].join('\n')
}

// mirrors stationMemberChangeMessage in src/lib/station.ts
function memberChangeMessage(
  actor: string,
  target: string,
  change: StationRole | 'remove',
  nonce: string,
): string {
  return [
    'Agent Souk station member change',
    `site: ${SITE}`,
    `by: ${actor.toLowerCase()}`,
    `member: ${target.toLowerCase()}`,
    `change: ${change}`,
    `nonce: ${nonce}`,
  ].join('\n')
}

async function sign(message: string, address: string): Promise<string> {
  const provider = await getProvider()
  return (await provider.request({ method: 'personal_sign', params: [message, address] })) as string
}

// the wallet signs a nonce that has never been spent, so a replayed sign-in is refused
export async function stationSignIn(): Promise<StationSession> {
  const address = await getActiveAccount()
  if (!address) throw new Error('Connect the wallet to sign into the station.')

  const asked = await fetch(`${BASE}/station/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  const issued = await asked.json().catch(() => null)
  if (!asked.ok || !issued?.nonce) throw new Error(issued?.error ?? 'The station could not issue a nonce.')

  const signature = await sign(issued.message as string, address)
  const opened = await fetch(`${BASE}/station/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, nonce: issued.nonce, signature }),
  })
  const payload = await opened.json().catch(() => null)
  if (!opened.ok || !payload?.session) throw new Error(payload?.error ?? 'The station refused that sign-in.')
  return payload.session as StationSession
}

export async function stationSignOut(token: string, everywhere = false): Promise<void> {
  await fetch(`${BASE}/station/session`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ everywhere }),
  }).catch(() => {})
}

async function authed<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}/station/${path}`, { headers: { authorization: `Bearer ${token}` } })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) throw new Error(payload?.error ?? 'The station could not answer.')
  return payload as T
}

export function stationMembers(token: string): Promise<{ success: true; members: StationMember[]; audit: AuditEntry[] }> {
  return authed(token, 'members')
}

export function stationOverview(token: string): Promise<{ success: true; overview: StationOverview }> {
  return authed(token, 'overview')
}

export function stationOperations(token: string): Promise<{ success: true; operations: StationOperations }> {
  return authed(token, 'operations')
}

// a change is signed against its own nonce and against the target address, so the
// server cannot be replayed into promoting a different wallet
export async function changeMemberRole(
  token: string,
  actor: string,
  target: string,
  change: StationRole | 'remove',
): Promise<{ success: true; members: StationMember[] }> {
  const asked = await fetch(`${BASE}/station/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: actor }),
  })
  const issued = await asked.json().catch(() => null)
  if (!asked.ok || !issued?.nonce) throw new Error(issued?.error ?? 'The station could not issue a nonce.')

  const signature = await sign(memberChangeMessage(actor, target, change, issued.nonce as string), actor)
  const method = change === 'remove' ? 'DELETE' : 'POST'
  const res = await fetch(`${BASE}/station/members`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ address: target, role: change === 'remove' ? undefined : change, nonce: issued.nonce, signature }),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || !payload?.success) throw new Error(payload?.error ?? 'That change was refused.')
  return payload
}
