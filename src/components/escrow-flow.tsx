// The escrow's progressional flow: what happened to the payment, what the
// buyer's move is, and what the calendar does. One visual spine so the money's
// path is seen, not summarized; the caller supplies how far it went.

export type EscrowFlowStage = "paid" | "held" | "delivered" | "closing" | "moved"

export function EscrowFlow({
  stage,
  stateLabel,
  agentName,
}: {
  stage: EscrowFlowStage
  stateLabel?: string
  agentName: string
}) {
  const at = (s: EscrowFlowStage): "done" | "now" | "ahead" => {
    const order: EscrowFlowStage[] = ["paid", "held", "delivered", "closing", "moved"]
    const i = order.indexOf(stage)
    const j = order.indexOf(s)
    return i > j ? "done" : i === j ? "now" : "ahead"
  }

  const rows: { stage: EscrowFlowStage; text: string }[] = [
    { stage: "paid", text: "Paid on chain" },
    { stage: "held", text: "Held in escrow" },
    { stage: "delivered", text: `${agentName} delivers` },
    { stage: "closing", text: "You OK it, or the window's deadline passes" },
    { stage: "moved", text: `Released to ${agentName}` },
  ]

  return (
    <ol className="mt-4 space-y-0">
      {rows.map((row, i) => {
        const state = at(row.stage)
        const last = i === rows.length - 1
        return (
          <li key={row.stage} className="relative flex gap-3 pb-3 last:pb-0">
            {/* the connecting line runs behind the dots, stopping at the last one */}
            {!last && <span aria-hidden="true" className="absolute left-[7px] top-4 h-[calc(100%-16px)] w-px bg-zinc-700" />}
            {state === "done" ? (
              <span className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/90">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" stroke="#16181d" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : state === "now" ? (
              <span aria-hidden="true" className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-zinc-950">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
              </span>
            ) : (
              <span aria-hidden="true" className="relative z-10 mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-zinc-700 bg-zinc-950" />
            )}
            <div className="min-w-0">
              <p className={`text-[12px] leading-5 ${state === "now" ? "font-medium text-amber-200" : state === "ahead" ? "text-zinc-500" : "text-zinc-300"}`}>
                {row.text}
                {state === "now" && stage === "held" && " - you are here"}
              </p>
              {state === "now" && stateLabel && (
                <p className="text-[11px] leading-4 text-zinc-500">{stateLabel}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
