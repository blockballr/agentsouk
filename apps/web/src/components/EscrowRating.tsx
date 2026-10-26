import { useState } from 'react'
import { useConnectedAccount } from '../lib/use-connected-account'
import { signPersonalMessage } from '../lib/wallet'
import { getRatings, submitEscrowRating, type EscrowRating as RatingRow, type EscrowRatingSummary } from '../lib/api'
import { Btn, Stack, Txt } from './souk'

// Rating form for a completed escrow (ERC-8183) job. The buyer signs the rating
// message with their wallet and the API stores score, comment and verifier score
// keyed to the payment that funded the job. One rating per payment.
export function EscrowRating({
  chainId,
  tokenId,
  paymentId,
  agentName,
}: {
  chainId: number
  tokenId: string
  paymentId: string
  agentName: string
}) {
  const account = useConnectedAccount()
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [verifierScore, setVerifierScore] = useState(80)
  const [phase, setPhase] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<EscrowRatingSummary | null>(null)
  const [ratings, setRatings] = useState<RatingRow[]>([])
  const [loaded, setLoaded] = useState(false)

  async function load() {
    if (loaded) return
    try {
      const r = await getRatings(chainId, tokenId)
      setRatings(r.ratings)
      setSummary(r.summary)
      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }

  // load on first render
  if (!loaded) void load()

  const alreadyRated = ratings.some((r) => r.paymentId === paymentId && r.rater.toLowerCase() === (account ?? '').toLowerCase())

  async function submit() {
    if (!account || !stars || phase === 'sending') return
    setPhase('sending')
    setError(null)
    try {
      const message = [
        'Agent Souk rating',
        `chainId: ${chainId}`,
        `tokenId: ${tokenId}`,
        `paymentId: ${paymentId}`,
        `score: ${stars}`,
        `comment: ${comment.trim()}`,
        `verifierScore: ${verifierScore}`,
      ].join('\n')
      const signature = await signPersonalMessage(account, message)
      const r = await submitEscrowRating({
        chainId,
        tokenId,
        paymentId,
        score: stars,
        comment: comment.trim(),
        verifierScore,
        rater: account,
        signature,
      })
      setRatings((prev) => [...prev, r.rating])
      setSummary(r.summary)
      setPhase('done')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  if (phase === 'done') {
    return (
      <Stack gap={6} className="mt-3 rounded-[8px] border hairline border-highlighter-green/50 p-3">
        <Txt size={12} lead={18} tone="ink">Rated {stars} of 5. Thanks for the feedback.</Txt>
        {summary && summary.count > 0 && (
          <Txt size={11} lead={16} tone="muted">
            {summary.count} rating{summary.count === 1 ? '' : 's'} · avg {summary.average}/5 · verifier avg {summary.verifierAverage}
          </Txt>
        )}
      </Stack>
    )
  }

  return (
    <Stack gap={8} className="mt-3 rounded-[8px] border hairline border-slate-verdant/30 p-3">
      <Txt size={12} lead={18} weight="bold" tone="ink">Rate {agentName}</Txt>
      {alreadyRated && (
        <Txt size={11} lead={16} tone="muted">You have already rated this job.</Txt>
      )}
      {summary && summary.count > 0 && (
        <Txt size={11} lead={16} tone="muted">
          {summary.count} rating{summary.count === 1 ? '' : 's'} · avg {summary.average}/5 · verifier avg {summary.verifierAverage}
        </Txt>
      )}
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            disabled={alreadyRated}
            className={`h-8 w-8 rounded-full border text-xs font-semibold ${stars >= n ? 'bg-souk-indigo text-white border-souk-indigo' : 'border-souk-hair text-souk-ink'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What went well, what didn't"
        rows={3}
        disabled={alreadyRated}
        className="w-full rounded-[6px] border border-souk-hair bg-white px-3 py-2 text-[12px] text-souk-ink"
      />
      <label className="flex items-center gap-2 text-[11px] text-souk-ink">
        Verifier score (0-100)
        <input
          type="number"
          min={0}
          max={100}
          value={verifierScore}
          onChange={(e) => setVerifierScore(Number(e.target.value))}
          disabled={alreadyRated}
          className="w-20 rounded-[6px] border border-souk-hair px-2 py-1 text-[12px]"
        />
      </label>
      <Btn kind="off" onClick={submit} disabled={!account || !stars || alreadyRated || phase === 'sending'}>
        {phase === 'sending' ? 'Signing...' : 'Submit rating'}
      </Btn>
      {error && <Txt size={11} lead={16} tone="slate">{error}</Txt>}
      {!account && <Txt size={11} lead={16} tone="muted">Connect the wallet that hired this agent to rate.</Txt>}
    </Stack>
  )
}