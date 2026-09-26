// shared hire runner: requirements -> wallet sign -> settle -> receipt

import type { PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'
import { X402_VERSION, randomNonce, x402Domain } from '@agora/core'
import { getHireRequirements, getReceipt, settleHire, type X402Requirements } from './api'
import { activeAccountMatches, chainIdToHex, ensureBscChain, getActiveAccount, getChainTimestamp, setTargetChain, WalletUnavailableError, WrongSignerError, signTransferAuthorization } from './wallet'

export type HireRequirementsData = X402Requirements['data']

export interface HireAgentRef {
  chainId: number
  tokenId: number
  name: string
}

export type HirePhase = 'requirements' | 'signing' | 'settling' | 'done' | 'failed'

export interface HireStep {
  phase: HirePhase
  error?: string
}

export interface HireOutcome {
  success: boolean
  paymentId?: string
  txHash?: string
  receipt?: Receipt | null
  error?: string
  // true when the user rejected the signature: a batch caller should stop
  cancelled?: boolean
  settle?: SettleResult
}

// maps our token revert selectors to a sentence; unknown failures get a generic line
const REVERT_PLAIN_ENGLISH: { test: RegExp; message: string }[] = [
  {
    test: /e450d38c|InsufficientBalance|insufficient balance/i,
    message: 'This wallet does not have enough sUSD to cover the hire.',
  },
  {
    test: /fb8f41b2|InsufficientAllowance/i,
    message: 'This wallet has not approved enough sUSD for the payment.',
  },
  {
    test: /10761275|EIP3009Expired/i,
    message: 'That authorisation had already expired, so it could not be used. Start the hire again.',
  },
  {
    test: /c6eeaf81|EIP3009NotYetValid/i,
    message: 'That authorisation is not valid yet. Wait a moment and start the hire again.',
  },
  {
    test: /9c87612c|EIP3009AlreadyUsed/i,
    message: 'That payment was already completed, so it cannot be used again.',
  },
  {
    test: /3e3ef59c|EIP3009Unauthorized|EIP712InvalidSignature|f44a5048/i,
    message: 'The signature did not match the address that signed it. If you switched accounts in your wallet, start again with the account you want to pay from.',
  },
  {
    test: /ec442f05|96c6fd1e|InvalidReceiver|InvalidSender/i,
    message: 'The payment could not be sent to that address. Check the agent wallet and try again.',
  },
  {
    test: /insufficient funds for gas|exceeds account balance/i,
    message: 'This wallet does not have enough BNB to pay for the transaction.',
  },
  {
    // not a bare "network": that also matches our own "switch networks" message
    test: /fetch failed|failed to fetch|ECONNREFUSED|ETIMEDOUT|socket hang up|network request failed|load failed/i,
    message: 'We could not reach BSC. Check your connection and try again.',
  },
  {
    test: /wrong network|unsupported chain|switch networks/i,
    message: 'Your wallet is on the wrong network. Switch to BSC and try again.',
  },
  {
    test: /nonce|already been used/i,
    message: 'That authorisation has already been used. Start the hire again.',
  },
]

/** A short, plain-English sentence for a failed hire, with no library internals. */
export function hireErrorText(e: unknown): string {
  if (e instanceof WalletUnavailableError) return e.message
  if (e instanceof WrongSignerError) return e.message

  const code = (e as { code?: number }).code
  if (code === 4001) return 'You cancelled this in your wallet, so nothing was charged.'

  const raw = (e as Error)?.message ?? ''
  if (!raw) return 'Something went wrong on our side. Please try again.'

  const lower = raw.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) {
    return 'You cancelled this in your wallet, so nothing was charged.'
  }

  for (const { test, message } of REVERT_PLAIN_ENGLISH) {
    if (test.test(raw)) return message
  }

  // a viem error puts the machine-readable detail in `details`, so check that too
  const details = String((e as { details?: string })?.details ?? '')
  for (const { test, message } of REVERT_PLAIN_ENGLISH) {
    if (details && test.test(details)) return message
  }

  if (/^execution reverted/i.test(lower) || /^viem|@viem|version:/i.test(lower)) {
    return 'The payment could not be completed. If this keeps happening, mint some sUSD and try again.'
  }

  // anything left is our own short sentence, so it is safe to show
  if (raw.length <= 140 && !raw.includes('0x') && !raw.includes('viem')) return raw

  return 'The payment could not be completed. Please try again.'
}

// a rejected signature means the user said stop (code 4001 / wallet message)
function isUserRejection(e: unknown): boolean {
  const code = (e as { code?: number }).code
  if (code === 4001) return true
  const msg = (e as Error)?.message ?? ''
  return msg.includes('user rejected') || msg.includes('User denied')
}

export async function fetchHireRequirements(
  agent: HireAgentRef,
  wallet: { address: string },
): Promise<HireRequirementsData> {
  return getHireRequirements(String(agent.chainId), String(agent.tokenId), wallet.address)
}

// sign the EIP-3009 authorization and settle it; onPhase('hired') fires on success
export async function signAndSettleHire(
  data: { paymentRequirements: PaymentRequirements; preview: PreviewResult; agent: HireRequirementsData['agent'] },
  onPhase: (phase: 'signing' | 'settling' | 'hired') => void,
): Promise<HireOutcome> {
  const pr = data.paymentRequirements
  try {
    // chain comes from the requirements, so wallet and signing domain cannot disagree
    const signedChainId = Number(pr.network.split(':')[1])
    if (!Number.isFinite(signedChainId) || signedChainId <= 0) {
      return {
        success: false,
        error: `Payment requirements carried an unusable network: ${pr.network}.`,
        cancelled: true,
      }
    }
    setTargetChain(signedChainId)
    const chain = await ensureBscChain()
    if (chain?.toLowerCase() !== chainIdToHex(signedChainId)) {
      return {
        success: false,
        error: `Wallet is not on ${signedChainId === 97 ? 'BSC testnet' : 'BSC'}, switch networks and retry.`,
        cancelled: true,
      }
    }
    // re-read the active account at sign time; the wallet signs with whatever is active
    const signer = await getActiveAccount()
    if (!signer) {
      return {
        success: false,
        error: 'No wallet account active, reconnect.',
        cancelled: true,
      }
    }
    // stability backstop: the account must read the same just before signing
    if (!(await activeAccountMatches(signer))) {
      return {
        success: false,
        error: 'Wallet account changed, reconnect and try again.',
        cancelled: true,
      }
    }
    onPhase('signing')
    // anchor validity to chain time, so a slow host clock cannot sign an expired authorization
    const now = (await getChainTimestamp()) ?? Math.floor(Date.now() / 1000)
    const message = {
      from: signer,
      to: pr.payTo,
      value: pr.amount,
      validAfter: String(now - 60),
      validBefore: String(now + pr.maxTimeoutSeconds),
      nonce: randomNonce(),
    }
    const signature = await signTransferAuthorization(signer, x402Domain(pr), message)
    onPhase('settling')
    const resource = data.preview.resource
    const settle = await settleHire({
      paymentId: data.preview.paymentId,
      paymentRequirements: pr,
      paymentPayload: {
        x402Version: X402_VERSION,
        payload: { authorization: { ...message, signature }, resource },
        resource,
        accepted: pr,
      },
      agent: { ...data.agent },
    })
    if (!settle.success) throw new Error(settle.error ?? 'Settlement failed.')
    onPhase('hired')
    const receipt = await getReceipt(settle.paymentId)
    return {
      success: true,
      paymentId: settle.paymentId,
      txHash: settle.txHash,
      receipt,
      settle,
    }
  } catch (e) {
    return {
      success: false,
      error: hireErrorText(e),
      cancelled: isUserRejection(e),
    }
  }
}

// one full hire for a single agent; the caller must have connected the wallet
export async function runHire(
  agent: HireAgentRef,
  wallet: { address: string },
  onStep: (s: HireStep) => void,
): Promise<HireOutcome> {
  try {
    onStep({ phase: 'requirements' })
    const data = await fetchHireRequirements(agent, wallet)
    const outcome = await signAndSettleHire(data, (phase) => {
      if (phase !== 'hired') onStep({ phase })
    })
    if (outcome.success) {
      onStep({ phase: 'done' })
    } else {
      onStep({ phase: 'failed', error: outcome.error })
    }
    return outcome
  } catch (e) {
    const error = hireErrorText(e)
    onStep({ phase: 'failed', error })
    return { success: false, error, cancelled: isUserRejection(e) }
  }
}
