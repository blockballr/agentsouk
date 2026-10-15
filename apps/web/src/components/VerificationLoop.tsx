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

/** A stepped panel: every check in marketplace order, each with its own live state and detail. */
export function VerificationLoop({ checks }: { checks: CheckLine[] }) {
  const settled = checks.filter((c) => c.state !== 'waiting' && c.state !== 'checking').length
  return (
    <section
      aria-label="Verification loop"
      aria-live="polite"
      className="rounded-[14px] border border-white/15 bg-souk-indigo p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="micro text-souk-indigo-labels">The verification loop</p>
        {settled > 0 && (
          <span className="micro text-souk-indigo-labels">
            {settled} of {checks.length} checked
          </span>
        )}
      </div>
      <ol className="mt-4 space-y-3">
        {checks.map((check, i) => (
          <li key={check.id} className="flex gap-3">
            <span className="mt-0.5 font-mono text-[11px] text-souk-indigo-labels">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-sm text-white">{check.title}</p>
                <span
                  className={`micro rounded-full border px-2 py-0.5 ${STATE_TONE[check.state]}`}
                >
                  {STATE_LABEL[check.state]}
                </span>
              </div>
              {check.detail && (
                <p className="mt-1 text-xs leading-relaxed text-souk-indigo-labels">{check.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
