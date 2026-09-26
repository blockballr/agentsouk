// prepare mints a claim and its document, then the owner signs register(), then confirm records the id

import type { RegistrationDraft } from '@agora/core'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export interface PrepareResult {
  claimId: string
  agentUri: string
  chainId: number
  registryAddress: string
  registerCalldata: string
}

export interface ConfirmResult {
  status: 'confirmed' | 'refuted'
  agentId: string
  txHash: string
  agentUri: string
  verification?: { verified?: boolean; detail?: string }
}

export async function prepareRegistration(
  draft: RegistrationDraft,
  owner: string,
): Promise<PrepareResult> {
  const res = await fetch(`${BASE}/agents/register/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft, owner }),
  })
  const body = (await res.json().catch(() => null)) as
    | (PrepareResult & { success: boolean; error?: string; errors?: string[] })
    | null
  if (!res.ok || !body?.success) {
    throw new Error(body?.errors?.[0] ?? body?.error ?? 'Could not prepare the listing.')
  }
  return body
}

export async function confirmRegistration(args: {
  claimId: string
  agentId: string
  txHash: string
}): Promise<ConfirmResult> {
  const res = await fetch(`${BASE}/agents/register/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = (await res.json().catch(() => null)) as
    | (ConfirmResult & { success: boolean; error?: string })
    | null
  if (!body) throw new Error('No response from the registry check.')

  // a refuted claim is a definite negative from the chain, not a transport error
  if (body.status === 'refuted') return body
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? 'The registry check could not be completed.')
  }
  return body
}

/** ERC-721 Transfer topic: the mint from the zero address carries the new id. */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** Pull the minted token id out of a registration receipt: ERC-721 Transfer puts it in topics[3], not topics[2]. */
export function tokenIdFromReceipt(
  logs: { address: string; topics: string[]; data: string }[],
  registryAddress: string,
): string | null {
  const registry = registryAddress.toLowerCase()
  for (const log of logs) {
    if (log.address?.toLowerCase() !== registry) continue
    if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
    if (!/^0x0{64}$/i.test(log.topics[1] ?? '')) continue
    const tokenId = log.topics[3]
    if (!tokenId) continue
    return BigInt(tokenId).toString()
  }
  return null
}
