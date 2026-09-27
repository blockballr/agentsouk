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

export interface ReceiptLog {
  address: string
  topics: string[]
  data: string
}

export interface TransactionReceipt {
  status?: string
  logs?: ReceiptLog[]
}

export interface ReceiptWaitOptions {
  /** Total budget before giving up on the receipt. */
  timeoutMs?: number
  /** Delay between reads. */
  intervalMs?: number
  /** How long one read may hang before it counts as a miss. */
  readTimeoutMs?: number
  /** Called after each empty read with the elapsed milliseconds, so the ui can report honestly. */
  onProgress?: (elapsedMs: number) => void
}

export const RECEIPT_TIMEOUT_MS = 90_000
export const RECEIPT_POLL_MS = 2_500

// A wallet provider can stop answering without rejecting, for example when its
// popup closes with the request in flight, so a single read must never be
// allowed to hang the whole wait past its budget.
export const POLL_READ_TIMEOUT_MS = 15_000

function withPollTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/**
 * eth_getTransactionReceipt resolves as soon as a transaction is broadcast, so one immediate
 * read is normally null and says nothing about mining. Poll until the receipt exists or the
 * budget runs out, and return null on timeout rather than treating pending as a result.
 */
export async function waitForTransactionReceipt(
  read: () => Promise<TransactionReceipt | null>,
  options: ReceiptWaitOptions = {},
): Promise<TransactionReceipt | null> {
  const timeoutMs = options.timeoutMs ?? RECEIPT_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? RECEIPT_POLL_MS
  const readTimeoutMs = options.readTimeoutMs ?? POLL_READ_TIMEOUT_MS
  const started = Date.now()
  for (;;) {
    const receipt = await withPollTimeout(Promise.resolve().then(read), readTimeoutMs)
    if (receipt) return receipt
    const elapsed = Date.now() - started
    if (elapsed >= timeoutMs) return null
    options.onProgress?.(elapsed)
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, timeoutMs - elapsed)))
  }
}

/** ERC-721 Transfer topic: the mint from the zero address carries the new id. */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** Pull the minted token id out of a registration receipt: ERC-721 Transfer puts it in topics[3], not topics[2]. */
export function tokenIdFromReceipt(logs: ReceiptLog[], registryAddress: string): string | null {
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

// The marketplace will not call a loopback or private address from its own server, and the shelf
// will not list one. This mirrors src/lib/endpoint.ts so a lister learns the same rule before the
// registration transaction rather than after, when the gas is already spent.
export function privateEndpointReason(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return `"${url}" is not a valid url`
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `"${url}" is not an http url`
  }
  // URL.hostname keeps the brackets on an ipv6 literal
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host)
  const privateV4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  if (loopback || privateV4) {
    return `"${url}" is a private address that the marketplace cannot reach`
  }
  return null
}

export type EndpointProbeState = 'answered' | 'unverified' | 'refused'

export interface EndpointProbe {
  state: EndpointProbeState
  detail: string
}

/**
 * A deterministic fault the marketplace will not tolerate: an unparseable url, a
 * non-http scheme, a loopback or private address, or a plain http url the registry
 * rejects. Returns null for anything that could still be a valid listing.
 */
export function endpointRefusal(raw: string): string | null {
  const url = raw.trim()
  if (!url) return null
  const privateReason = privateEndpointReason(url)
  if (privateReason) {
    return `${privateReason}. The marketplace will not call it and the shelf will not list it, so a registration here would be dark.`
  }
  return new URL(url).protocol === 'https:'
    ? null
    : 'The registry only accepts an https endpoint, so an http url is rejected at registration.'
}

/**
 * Asks the typed endpoint whether it answers, from the browser, before any gas is
 * spent. A cross-origin request the browser will not complete is reported as
 * unverified rather than broken, because a CORS policy is not an outage.
 */
export async function probeEndpoint(raw: string): Promise<EndpointProbe> {
  const url = raw.trim()
  if (!url) {
    return { state: 'refused', detail: 'No endpoint to test yet. Paste the address a buyer would call.' }
  }
  const refusal = endpointRefusal(url)
  if (refusal) return { state: 'refused', detail: refusal }

  const signal = AbortSignal.timeout(7000)

  // A readable response is the strongest signal: the endpoint answered and allowed this origin.
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', signal })
    return { state: 'answered', detail: `The endpoint answered with HTTP ${res.status}.` }
  } catch {
    // CORS, an extension, an offline browser or the timeout all reject here; none of them prove the
    // endpoint is down, so only a second, opaque attempt can tell a policy block from a network fault.
  }

  try {
    // no-cors resolves once a response is received even without CORS headers, so a rejection here
    // is much more likely to be a network fault than the endpoint's own policy.
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal })
    return {
      state: 'answered',
      detail:
        'The endpoint answered, but did not let this page read the reply. That is a cross-origin policy, not an outage.',
    }
  } catch {
    return {
      state: 'unverified',
      detail:
        'The browser could not complete a request from this page, which can be a cross-origin block or a network fault. Open the endpoint in a new tab to confirm it answers, then register.',
    }
  }
}
