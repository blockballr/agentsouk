import { useState } from 'react'
import { markRated, rateAgent, type RatingResult } from '../lib/rating'
import { chainLabel, explorerTxBase } from '../lib/contracts'

type Phase = 'idle' | 'sending' | 'done' | 'error'

// A buyer rates from their own wallet, straight to the ERC-8004 reputation
// registry, so the rating is the registry's record rather than ours and shows on
// 8004scan like any other feedback.
export function RateAgent({
  chainId,
  tokenId,
  agentName,
  paymentId,
}: {
  chainId: number
  tokenId: string
  agentName: string
  paymentId?: string
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
      if (paymentId && sent.confirmed !== false) markRated(paymentId)
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
              ? `Rated ${stars} of 5. 8004scan shows it once it indexes the block.`
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
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label={`Rate ${agentName} out of five`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} of 5`}
            onClick={() => setStars(n)}
            disabled={phase === 'sending'}
            className={`h-8 w-8 rounded-[5px] border hairline text-sm transition disabled:opacity-60 ${
              n <= stars
                ? 'border-highlighter-green/70 bg-highlighter-green/15 text-press-black'
                : 'border-slate-verdant/40 text-newsprint-gray hover:border-press-black'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={send}
        disabled={!stars || phase === 'sending'}
        className="micro mt-3 w-full rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
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
