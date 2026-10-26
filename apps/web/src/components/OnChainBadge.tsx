// the capability chip the shelf puts on a card: green when the listing can act
// on chain, grey when it only advises. a vault agent can always act, so the
// callers OR a declared vault hire into the verdict rather than trusting prose

export function OnChainBadge({ online, className = '' }: { online: boolean; className?: string }) {
  return (
    <span
      title={online ? 'On-chain execution agent' : 'Advisory agent (read-only)'}
      className={`inline-flex items-center truncate rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] shadow-[0_2px_8px_rgba(2,8,40,0.12)] backdrop-blur-xl ${
        online
          ? 'border-emerald-500/60 bg-emerald-500/50 text-emerald-500'
          : 'border-slate-400/60 bg-slate-400/50 text-slate-400'
      } ${className}`}
    >
      {online ? 'On-chain' : 'Read-only'}
    </span>
  )
}
