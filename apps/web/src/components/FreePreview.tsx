import { useState } from 'react'
import type { AgentCardSkill } from '../lib/api'
import { runFreePreview } from '../lib/api'

interface FreePreviewProps {
  endpoint: string
  skills: AgentCardSkill[]
}

// Agents advertise skills whose direct call returns a free preview of what a
// hire would produce. This panel runs one such skill through the marketplace with
// the skill's own example as the input, so a buyer sees the answer before paying.
// It goes through the marketplace rather than the browser because a third-party
// agent's endpoint does not need to allow the browser, which is why the panel
// failed for most listings.
export function FreePreview({ endpoint, skills }: FreePreviewProps) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A preview only runs a skill the card itself worked out an example for. If an
  // agent declares inputs but no example, guessing them is worse than showing no
  // panel: the answer would be the marketplace's invention, not the agent's.
  const previewSkill = skills.find((s) => {
    const id = (s.id ?? s.name ?? '').toLowerCase()
    if (id.startsWith('negotiate') || id.startsWith('notify_funded')) return false
    return (s.examples?.length ?? 0) > 0 || (s.inputSchema?.examples?.length ?? 0) > 0
  })

  if (!previewSkill || !endpoint) return null

  const skillId = previewSkill.id

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const { text } = await runFreePreview(endpoint, skillId)
      setResult(text || 'The agent answered without text.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-4 border border-souk-hair bg-souk-surface1 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-souk-ink">Free preview</p>
          <p className="text-[11px] text-souk-muted">
            Runs the published preview before payment.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded-none bg-souk-data px-4 py-2 text-[13px] font-semibold text-souk-canvas transition hover:brightness-95 disabled:opacity-40"
        >
          {running ? 'Running...' : 'Run preview'}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-[12px] text-souk-peach">{error}</p>
      )}
      {result && (
        <pre className="mt-3 max-h-64 overflow-auto bg-souk-canvas p-3 text-[11px] leading-[16px] text-souk-slate whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </div>
  )
}

export default FreePreview