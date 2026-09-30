import { encodeFunctionData, zeroHash } from 'viem'
import { chainIdToHex, connectWallet, ensureBscChain, getActiveAccount, getProvider, setTargetChain } from './wallet'
import { waitForTransactionReceipt, withSendTimeout, type TransactionReceipt } from './register'
import { reputationRegistryFor } from './contracts'

// read from the deployed v2.0.0 registry on chains 97 and 56, selector 0x3c036a7e;
// the older spec shapes are not deployed there
const GIVE_FEEDBACK_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

// 8004scan scores only feedback tagged "starred", on a 0 to 100 scale, and the
// second tag says the rating came through this marketplace
export const RATING_TAG = 'starred'
export const RATING_SOURCE_TAG = 'agentsouk'

export function starsToScore(stars: number): number {
  const whole = Math.round(stars)
  if (!Number.isFinite(whole) || whole < 1 || whole > 5) throw new Error('A rating is one to five stars.')
  return whole * 20
}

export function feedbackCalldata(tokenId: string, stars: number): `0x${string}` {
  return encodeFunctionData({
    abi: GIVE_FEEDBACK_ABI,
    functionName: 'giveFeedback',
    args: [BigInt(tokenId), BigInt(starsToScore(stars)), 0, RATING_TAG, RATING_SOURCE_TAG, '', '', zeroHash],
  })
}

// the hires this browser has rated, so a finished hire stops asking; the registry would take
// a second rating, so this spares the buyer a repeat rather than guarding against one
const RATED_KEY = 'souk.rated'

// each rated hire keeps the stars it was given; a rating saved before the stars were kept
// reads as rated with no stars
export function ratedHires(): Map<string, number | null> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RATED_KEY) ?? '{}')
    if (Array.isArray(raw)) {
      return new Map(raw.filter((v): v is string => typeof v === 'string').map((id) => [id, null]))
    }
    if (raw && typeof raw === 'object') {
      return new Map(Object.entries(raw).map(([id, v]) => [id, typeof v === 'number' ? v : null]))
    }
  } catch {
    // storage blocked; nothing is remembered
  }
  return new Map()
}

export function markRated(paymentId: string, stars: number): void {
  try {
    const rated = ratedHires()
    rated.delete(paymentId)
    rated.set(paymentId, stars)
    localStorage.setItem(RATED_KEY, JSON.stringify(Object.fromEntries([...rated].slice(-200))))
  } catch {
    // storage blocked or full; the rating itself is already on chain
  }
}

export interface RatingResult {
  txHash: `0x${string}`
  // null while the receipt has not arrived inside the wait
  confirmed: boolean | null
}

// the registry refuses feedback from the agent's owner or its operators, and the
// wallet surfaces that as a failed estimate, so the reason is named plainly
function ratingErrorText(e: unknown): string {
  const err = e as Error & { code?: number }
  if (err?.code === 4001) return 'You cancelled the rating, so nothing was sent.'
  const text = String(err?.message ?? '')
  if (/self-feedback/i.test(text)) return "The agent's owner cannot rate their own agent."
  if (text.includes('did not answer') || /^(Switch your wallet|Connect the wallet)/.test(text)) return text
  return 'The rating could not be sent. Nothing was recorded.'
}

export async function rateAgent(chainId: number, tokenId: string, stars: number): Promise<RatingResult> {
  const registry = reputationRegistryFor(chainId)
  if (!registry) throw new Error('This network has no reputation registry to rate on.')
  const data = feedbackCalldata(tokenId, stars)
  try {
    const provider = await getProvider()
    const account = (await getActiveAccount()) ?? (await connectWallet())
    if (!account) throw new Error('Connect the wallet that hired this agent.')
    // the wallet's target chain is only set by some pages, so a rating opened on a fresh load
    // would otherwise go to the same address on the other chain, a different contract there
    setTargetChain(chainId)
    const chain = await ensureBscChain()
    if (chain?.toLowerCase() !== chainIdToHex(chainId)) {
      throw new Error(`Switch your wallet to ${chainId === 97 ? 'BSC testnet' : 'BSC'} to rate on it.`)
    }
    const txHash = (await withSendTimeout(
      provider.request({ method: 'eth_sendTransaction', params: [{ from: account, to: registry, data }] }) as Promise<`0x${string}`>,
    )) as `0x${string}`
    const receipt = await waitForTransactionReceipt(
      () => provider.request({ method: 'eth_getTransactionReceipt', params: [txHash] }) as Promise<TransactionReceipt | null>,
    )
    return { txHash, confirmed: receipt ? receipt.status === '0x1' || receipt.status === 'success' : null }
  } catch (e) {
    throw new Error(ratingErrorText(e))
  }
}
