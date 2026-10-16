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
export function VerificationLoop({ checks }: { checks: CheckLine[] }) {
  const [open, setOpen] = useState(false)
  const settled = checks.filter((c) => c.state !== 'waiting' && c.state !== 'checking').length
  // the loop reports one check at a time: the one running, or the one that stopped it
  const current =
    checks.find((c) => c.state === 'checking') ?? checks.find((c) => c.state === 'failed') ?? null
  const pct = checks.length > 0 ? Math.round((settled / checks.length) * 100) : 0
  return (
    <section
      aria-label="Verification"
      aria-live="polite"
      className="rounded-[14px] border border-white/15 bg-souk-indigo p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="micro text-souk-indigo-labels">Verification</p>
        <span className="font-mono text-[11px] text-souk-indigo-labels">
          {settled} of {checks.length}
        </span>
      </div>

      {/* the rail earns its fill the way the job meter does: an empty track until a check
          actually answers, so the bar never claims a pass it has not been given */}
      <div className="mt-3 h-[6px] w-full overflow-hidden rounded-[3px] bg-white/15">
        {settled > 0 && (
          <div
            className="h-full rounded-[3px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
            style={{
              width: `${pct}%`,
              backgroundImage: 'linear-gradient(90deg, #111a4a 0%, #44b48b 100%)',
            }}
          />
        )}
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
