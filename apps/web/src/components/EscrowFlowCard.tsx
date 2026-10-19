import { useState } from 'react'
import { escrowFlowIndex, type EscrowLifecycle } from '../lib/hire-state'

// The money's progression on a hire card, collapsed by default: a progress bar
// whose fill tracks the escrow stage, and the buyer's click expands it into the
// full flow with each stop named. The card never lends the height for that
// expanded view, so nothing renders until the buyer asks for it. A refund exits
// the flow, so the caption shows on its own without pretending the stops apply.

const STOP_LABELS = ['Paid', 'Held', 'Delivers', 'OK or deadline', 'Agent paid']

export function EscrowFlowCard({ spine, agentName }: { spine: EscrowLifecycle | null; agentName: string }) {
  const [open, setOpen] = useState(false)
  if (!spine) return null
  const refunded = spine.stage === 'refunded'
  const index = refunded ? null : escrowFlowIndex(spine.stage, spine.autoReleaseAt)
  const note =
    spine.autoReleaseAt !== null && spine.autoReleaseAt > Date.now()
      ? `Do nothing and the agent is paid at ${new Date(spine.autoReleaseAt).toLocaleTimeString()}`
      : null
  const pct = refunded || index === null ? 0 : (index / (STOP_LABELS.length - 1)) * 100

  if (refunded) {
    return (
      <p className="mt-1 flex items-center gap-2 text-[13px] text-newsprint-gray">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-press-black/60" />
        <span className="truncate">{spine.label}</span>
      </p>
    )
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Collapse the escrow flow' : spine.label}
        className="group flex w-full flex-col gap-1.5 rounded-[6px] py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] leading-4 text-newsprint-gray group-hover:text-press-black">
            {spine.label}
          </span>
          <span className="shrink-0 text-[10px] leading-none text-newsprint-gray transition group-hover:text-press-black">
            {open ? '▾' : '▸'}
          </span>
        </div>
        {/* progress bar: fill tracks the escrow stage */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-press-black/10">
          <div
            className="h-full rounded-full bg-highlighter-green transition-all duration-500"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={index ?? 0}
            aria-valuemin={0}
            aria-valuemax={STOP_LABELS.length - 1}
          />
        </div>
      </button>

      {open && (
        <div className="mt-1 space-y-0.5">
          {STOP_LABELS.map((label, i) => {
            const done = index !== null && index > i
            const now = index === i
            return (
              <p key={label} className={`flex items-center gap-2 text-[11px] leading-4 ${now ? 'font-medium text-press-black' : done ? 'text-press-black/70' : 'text-newsprint-gray'}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? 'bg-press-black' : now ? 'bg-highlighter-green ring-2 ring-highlighter-green/40 animate-pulse' : 'border hairline border-press-black/30'}`} />
                {label}
                {now && <span className="font-normal text-newsprint-gray">- here</span>}
              </p>
            )
          })}
          <p className="pl-3.5 text-[11px] leading-4 text-newsprint-gray">
            {agentName} holds nothing; the on-chain escrow holds the price.
            {note ? ` ${note}.` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
