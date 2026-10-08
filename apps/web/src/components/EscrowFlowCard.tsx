import { useState } from 'react'
import { escrowFlowIndex, type EscrowLifecycle } from '../lib/hire-state'

// The money's progression on a hire card, collapsed by default: five stops on
// one track at bar height, and the buyer's click expands it into the full flow
// with each stop named. The card never lends the height for that expanded,
// so nothing renders until the buyer asks for it. A refund exits the flow, so
// the caption shows on its own without pretending the five stops still apply.

const STOP_LABELS = ['Paid', 'Held', 'Delivers', 'OK or deadline', 'Agent paid']

function dot(_i: number, current: boolean, done: boolean): string {
  if (done) return 'bg-press-black'
  if (current) return 'bg-highlighter-green ring-2 ring-highlighter-green/40'
  return 'border hairline border-press-black/30'
}

export function EscrowFlowCard({ spine, agentName }: { spine: EscrowLifecycle | null; agentName: string }) {
  const [open, setOpen] = useState(false)
  if (!spine) return null
  const refunded = spine.stage === 'refunded'
  const index = refunded ? null : escrowFlowIndex(spine.stage, spine.autoReleaseAt)
  const note =
    spine.autoReleaseAt !== null && spine.autoReleaseAt > Date.now()
      ? `Do nothing and the agent is paid at ${new Date(spine.autoReleaseAt).toLocaleTimeString()}`
      : null

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
        className="group flex w-full items-center gap-1.5 rounded-[6px] py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        <span aria-hidden="true" className={`shrink-0 text-[10px] leading-none text-newsprint-gray transition group-hover:text-press-black ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
        <ol className="flex min-w-0 flex-1 items-center">
          {STOP_LABELS.map((_, i) => {
            const done = index !== null && index > i
            const now = index === i
            return (
              <li key={i} className="flex min-w-0 flex-1 items-center last:flex-none">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${dot(i, now, done)}${now ? ' animate-pulse' : ''}`}
                />
                {i < STOP_LABELS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={`h-px min-w-1.5 flex-1 ${index !== null && index > i ? 'bg-press-black/50' : 'bg-press-black/15'}`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </button>

      {open && (
        <div className="mt-1 space-y-0.5">
          {STOP_LABELS.map((label, i) => {
            const done = index !== null && index > i
            const now = index === i
            return (
              <p key={label} className={`flex items-center gap-2 text-[11px] leading-4 ${now ? 'font-medium text-press-black' : done ? 'text-press-black/70' : 'text-newsprint-gray'}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(i, now, done)}`} />
                {label}
                {now && <span className="font-normal text-newsprint-gray">- here</span>}
              </p>
            )
          })}
          <p className="pl-3.5 text-[11px] leading-4 text-newsprint-gray">
            {agentName} holds nothing; the kernel escrow holds the price.
            {note ? ` ${note}.` : ''}
          </p>
        </div>
      )}

      {!open && (
        <p className="truncate pl-3.5 text-[11px] leading-4 text-newsprint-gray">
          {spine.label}
        </p>
      )}
    </div>
  )
}
