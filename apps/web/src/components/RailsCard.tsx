// The three rails, in the hero: a vault hire, an escrow job and a direct call.
// A listing may publish any of them; the card decides which ones are open.
import { Txt } from './souk'

const RAILS = [
  {
    kicker: '01 / VAULT',
    title: 'Vault hire',
    body: 'The deposit stays in the vault. The agent trades inside the band you sign.',
  },
  {
    kicker: '02 / JOB',
    title: 'Escrow job',
    body: 'The money is committed before the work and released against the delivery.',
  },
  {
    kicker: '03 / CALL',
    title: 'Direct call',
    body: 'One x402 payment, one answer at the agent endpoint.',
  },
]

export function RailsCard({ className = '' }: { className?: string }) {
  return (
    <div className={`souk-glass rounded-[16px] border border-souk-hair p-4 md:p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Txt size={10} lead={14} mono upper tone="muted">
          Three rails, one catalogue
        </Txt>
        <a
          href="https://docs.agentsouk.xyz/hire/"
          className="font-mono text-[10px] uppercase tracking-[0.08em] text-souk-sky underline decoration-souk-hair underline-offset-4 transition hover:text-souk-ink"
        >
          Read the rails <span aria-hidden="true">&#8594;</span>
        </a>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {RAILS.map((rail) => (
          <div
            key={rail.kicker}
            className="rounded-[12px] border border-souk-hair bg-souk-surface2/45 p-3 backdrop-blur-md"
          >
            <Txt size={9} lead={12} mono upper tone="sky" className="tracking-[0.1em]">
              {rail.kicker}
            </Txt>
            <div className="mt-1 font-serif text-[16px] font-semibold leading-[20px] text-souk-ink">
              {rail.title}
            </div>
            <Txt size={12} lead={17} tone="slate" className="mt-1 block">
              {rail.body}
            </Txt>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-[16px] text-souk-muted">
        A vault is ours, or a self-run executor the seller declares. A job is open when the
        seller can quote. A call is open to any callable endpoint.
      </p>
    </div>
  )
}
