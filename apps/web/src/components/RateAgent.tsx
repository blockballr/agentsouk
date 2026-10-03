import { useState } from 'react'
import { markRated, rateAgent, type RatingResult } from '../lib/rating'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { RatingBoxes, button, cx } from './ui'

type Phase = 'idle' | 'sending' | 'done' | 'error'

// A buyer rates from their own wallet, straight to the ERC-8004 reputation
// registry, so the rating is the registry's record rather than ours and shows on
// 8004scan like any other feedback.
export function RateAgent({
  chainId,
  tokenId,
  agentName,
  paymentId,
  onRated,
}: {
  chainId: number
  tokenId: string
  agentName: string
  paymentId?: string
  onRated?: (stars: number) => void
}) {
  const [stars, setStars] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<RatingResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!stars || phase === 'sending') return
    setPhase('sending')
    setError(null)
    try {
      const sent = await rateAgent(chainId, tokenId, stars)
      if (sent.confirmed !== false) {
        if (paymentId) markRated(paymentId, stars)
        onRated?.(stars)
      }
      setResult(sent)
      setPhase('done')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  if (phase === 'done' && result) {
    return (
      <div className="mt-3 rounded-[8px] border hairline border-highlighter-green/50 p-3" role="status">
        <p className="text-xs leading-relaxed text-newsprint-gray">
          {result.confirmed === false
            ? 'The rating transaction was mined but reverted, so nothing was recorded.'
            : result.confirmed
              ? `Rated ${stars} of 5. It appears once the registry index has it.`
              : 'The rating was sent and is waiting to be mined.'}{' '}
          <a
            href={`${explorerTxBase(chainId)}/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="text-press-black underline-offset-2 hover:underline"
          >
            View the transaction
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-[8px] border hairline border-slate-verdant/30 p-3">
      <p className="micro text-newsprint-gray">Rate {agentName}</p>
      <div className="mt-2">
        <RatingBoxes
          value={stars || null}
          onPick={setStars}
          disabled={phase === 'sending'}
          size="md"
          label={`Rate ${agentName} out of five`}
        />
      </div>
      <button
        type="button"
        onClick={send}
        disabled={!stars || phase === 'sending'}
        className={cx(button('secondary', 'sm'), 'mt-3 w-full')}
      >
        {phase === 'sending' ? 'Waiting for your wallet…' : 'Send rating'}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-newsprint-gray">
        Your wallet sends ERC-8004 feedback to the reputation registry on {chainLabel(chainId)}, paying a
        little gas. It is public and can be revoked, not edited.
      </p>
      {error && (
        <p className="mt-2 text-[11px] leading-relaxed text-press-black" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
