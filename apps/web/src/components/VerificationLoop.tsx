import { useState } from 'react'

// The listing checks, in the order the marketplace applies them, shown as they run. Each line
// carries its own state so a lister sees which condition passed, which failed, and which the
// browser honestly could not determine.

export type CheckState = 'waiting' | 'checking' | 'passed' | 'failed' | 'undetermined'

export interface CheckLine {
  id: string
  title: string
  state: CheckState
  detail?: string
}

// What the wallet can pay with. The card states it next to the checks because
// the registration is the lister's own transaction and a short wallet stops the
// flow at the last step, after every check has already passed.
export interface GasReadiness {
  holds: boolean
  symbol: string
  balance: string | null
}

const STATE_LABEL: Record<CheckState, string> = {
  waiting: 'Waiting',
  checking: 'Checking',
  passed: 'Passed',
  failed: 'Failed',
  undetermined: 'Could not determine',
}

const STATE_TONE: Record<CheckState, string> = {
  waiting: 'border-white/20 text-souk-indigo-labels',
  checking: 'border-souk-data/50 text-white',
  passed: 'border-souk-data/50 text-souk-data',
  failed: 'border-souk-peach/50 text-souk-peach',
  undetermined: 'border-white/20 text-souk-indigo-labels',
}

// what each check requires, said in the plain terms the check itself applies, so a lister can
// read the whole bar before spending gas rather than learning the rules one refusal at a time
const REQUIREMENT: Record<string, string> = {
  endpoint: 'An https URL that is not a loopback or private address, since the marketplace calls it.',
  card: 'The agent card answers from your own browser. A cross-origin block is undetermined, never a failure.',
  classifier: 'The description says what the agent does, in the words buyers search for under its category.',
  terms: 'The server mints the document and returns the terms, and your wallet is on the registration chain.',
  transaction: 'One transaction, signed and mined from your own wallet. Nobody can send it for you.',
  confirm: 'The registry records the agent id, which is what makes the listing yours.',
  sweep: 'Nothing here earns the badge. The verifier probes the registered endpoint on its next sweep.',
}

/** A progress rail and the one check in flight, with the whole bar readable behind a toggle. */
export function VerificationLoop({
  checks,
  gas = null,
}: {
  checks: CheckLine[]
  gas?: GasReadiness | null
}) {
  const [open, setOpen] = useState(false)
  const settled = checks.filter((c) => c.state !== 'waiting' && c.state !== 'checking').length
  // the loop reports one check at a time: the one running, or the one that stopped it
  const current =
    checks.find((c) => c.state === 'checking') ?? checks.find((c) => c.state === 'failed') ?? null
  const pct = checks.length > 0 ? Math.round((settled / checks.length) * 100) : 0
  return (
    <section
      id="verifier-check"
      aria-label="Verifier check"
      aria-live="polite"
      tabIndex={-1}
      className="scroll-mt-4 border border-white/15 bg-souk-indigo p-4 outline-none transition focus-visible:ring-2 focus-visible:ring-souk-data/60"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="micro text-souk-indigo-labels">Verifier check</p>
        <span className="font-mono text-[11px] text-souk-indigo-labels">
          {settled} of {checks.length} ({pct}%)
        </span>
      </div>

      {gas ? (
        <div
          className={`mt-3 flex items-center gap-2 rounded-[8px] border px-3 py-2 backdrop-blur-md ${
            gas.holds
              ? 'border-souk-data/40 bg-souk-data/15'
              : 'border-souk-peach/45 bg-souk-peach/15'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${gas.holds ? 'bg-souk-data' : 'bg-souk-peach'}`}
          />
          <span className="micro text-white/70">Gas</span>
          <span className="ml-auto font-mono text-[11px] text-white">
            {gas.holds
              ? `enough ${gas.symbol}`
              : gas.balance === null
                ? 'no reading'
                : `${gas.balance} ${gas.symbol}`}
          </span>
        </div>
      ) : null}

      {/* the rail keeps a head at every value, the way the job meter does: even at
          zero the fill shows a sliver, so the track never reads as a broken control */}
      <div className="mt-3 h-[6px] w-full overflow-hidden rounded-[3px] bg-white/15">
        <div
          className="meter-fill relative h-full overflow-hidden rounded-[3px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{
            width: `${Math.max(pct, 2)}%`,
            minWidth: 6,
            backgroundImage: 'linear-gradient(90deg, #111a4a 0%, #c8ced9 100%)',
          }}
        >
          {current ? (
            <span
              aria-hidden="true"
              className="meter-shimmer absolute inset-y-0 left-0 w-[40%] rounded-[3px] bg-gradient-to-r from-transparent via-white/70 to-transparent"
            />
          ) : null}
        </div>
      </div>

      {current ? (
        <div className="mt-4 flex gap-3">
          <span className="mt-0.5 font-mono text-[11px] text-souk-indigo-labels">
            {String(checks.indexOf(current) + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm text-white">{current.title}</p>
              <span className={`micro rounded-full border px-2 py-0.5 ${STATE_TONE[current.state]}`}>
                {STATE_LABEL[current.state]}
              </span>
            </div>
            {current.detail && (
              <p className="mt-1 text-xs leading-relaxed text-souk-indigo-labels">{current.detail}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs leading-relaxed text-souk-indigo-labels">
          Nothing has run yet. Each check reports here the moment it answers.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="micro mt-4 border-b border-white/20 pb-0.5 text-souk-indigo-labels transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        {open ? 'Hide what the checks require' : 'What the checks require'}
      </button>

      {open && (
        <ol className="mt-3 space-y-3 border-t border-white/15 pt-3">
          {checks.map((check, i) => (
            <li key={check.id} className="flex gap-3">
              <span className="mt-0.5 font-mono text-[11px] text-souk-indigo-labels">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{check.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-souk-indigo-labels">
                  {REQUIREMENT[check.id] ?? check.detail ?? ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
