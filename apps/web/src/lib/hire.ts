// shared hire runner: requirements -> wallet sign -> settle -> receipt
// extracted verbatim from the detail page's hire panel so the compare bar
// (and the upcoming cart checkout) run the exact same flow: one gasless
// EIP-3009 signature per hire, settle direct, receipts recorded by the backend

import type { PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'
import { X402_VERSION, randomNonce, x402Domain } from '@agora/core'
import { getHireRequirements, getReceipt, settleHire, type X402Requirements } from './api'
import { SmartWalletUnsupportedError, WalletUnavailableError, isSmartWalletConnected, signTransferAuthorization } from './wallet'

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
  // true when the user rejected the signature in the wallet: the batch caller
  // should stop instead of continuing to the next hire
  cancelled?: boolean
  settle?: SettleResult
}

export function hireErrorText(e: unknown): string {
  if (e instanceof WalletUnavailableError) return e.message
  const code = (e as { code?: number }).code
  if (code === 4001) return 'Request cancelled in the wallet.'
  const msg = (e as Error)?.message ?? 'Something went wrong.'
  if (msg.includes('user rejected') || msg.includes('User denied')) {
    return 'Request cancelled in the wallet.'
  }
  return msg
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

// sign the EIP-3009 authorization and settle it; onPhase('hired') fires as
// soon as settlement succeeds, before the (non-fatal) receipt fetch
export async function signAndSettleHire(
  data: { paymentRequirements: PaymentRequirements; preview: PreviewResult; agent: HireRequirementsData['agent'] },
  address: string,
  onPhase: (phase: 'signing' | 'settling' | 'hired') => void,
): Promise<HireOutcome> {
  const pr = data.paymentRequirements
  try {
    // honest limitation: smart-account (ERC-4337) signatures validate on-chain
    // via ERC-1271, which our facilitator cannot verify — fail early with a
    // clear message instead of an opaque signature-verification error
    if (await isSmartWalletConnected()) throw new SmartWalletUnsupportedError()
    onPhase('signing')
    const now = Math.floor(Date.now() / 1000)
    const message = {
      from: address,
      to: pr.payTo,
      value: pr.amount,
      validAfter: String(now - 60),
      validBefore: String(now + pr.maxTimeoutSeconds),
      nonce: randomNonce(),
    }
    const signature = await signTransferAuthorization(address, x402Domain(pr), message)
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

// one full hire for a single agent; wallet must already be connected
// (connectWallet + ensureBscChain) by the caller
export async function runHire(
  agent: HireAgentRef,
  wallet: { address: string },
  onStep: (s: HireStep) => void,
): Promise<HireOutcome> {
  try {
    onStep({ phase: 'requirements' })
    const data = await fetchHireRequirements(agent, wallet)
    const outcome = await signAndSettleHire(data, wallet.address, (phase) => {
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
