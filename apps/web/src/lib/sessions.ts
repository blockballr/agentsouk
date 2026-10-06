// the session revoke, shared between the ongoing page and the agent page so
// both ask the wallet for the same signature and read the same outcome shape
import { revokeRequestMessage } from '@agora/core'
import { getProvider } from './wallet'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface RevokeOutcome {
  attempted: boolean
  canceled: boolean
  alreadyRevoked?: boolean
  txHash?: string
  chainId?: number
  txLink?: string
  error?: string
}

// The revoke response carries the on-chain cancellation result, which api.ts's
// revokeSession discards, so the endpoint is called directly to keep the
// transaction hash. The buyer signs a message, not a transaction, so nobody
// who only knows the paymentId can revoke the session.
export async function revokeSessionWithCancel(
  paymentId: string,
  client: string,
): Promise<RevokeOutcome | null> {
  const provider = await getProvider()
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [revokeRequestMessage(paymentId, client), client],
  })) as string
  const res = await fetch(`${API_BASE}/sessions?paymentId=${encodeURIComponent(paymentId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client, signature }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.success) throw new Error(body?.error ?? `revoke ${res.status}`)
  return (body.onchain as RevokeOutcome | undefined) ?? null
}
