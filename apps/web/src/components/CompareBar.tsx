import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SPRING_STIFF } from '../lib/motion'
import { connectWallet, ensureBscChain } from '../lib/wallet'
import { hireErrorText, runHire, type HireAgentRef } from '../lib/hire'

type HireItemPhase = 'pending' | 'requirements' | 'signing' | 'settling' | 'settled' | 'failed'

interface HireItemState {
  key: string
  name: string
  agent: HireAgentRef
  phase: HireItemPhase
  error?: string
}

const hireKey = (a: HireAgentRef) => `${a.chainId}/${a.tokenId}`

// floating compare shortlist bar, shared by the marketplace and the compare
// page; pages decide when to mount it, what the Compare action does, and
// whether the "Hire best" action is available (compare page passes winners
// from the best-in-category ranker; the marketplace passes nothing)
export function CompareBar({
  count,
  onClear,
  onCompare,
  hire,
}: {
  count: number
  onClear: () => void
  onCompare: () => void
  hire?: { winners: HireAgentRef[] }
}) {
  const [items, setItems] = useState<HireItemState[]>([])
  const [batchError, setBatchError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const allSettled = items.length > 0 && items.every((i) => i.phase === 'settled')

  function setPhase(key: string, phase: HireItemPhase, error?: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, phase, error } : i)))
  }

  async function startHire() {
    if (!hire || running || allSettled) return
    setRunning(true)
    setBatchError(null)
    // first run: one entry per winner; retry: only entries not settled yet,
    // settled hires always stay settled
    let batch: HireItemState[]
    if (items.length === 0) {
      batch = hire.winners.map((agent) => ({ key: hireKey(agent), name: agent.name, agent, phase: 'pending' as const }))
      setItems(batch)
    } else {
      const retryKeys = new Set(items.filter((i) => i.phase !== 'settled').map((i) => i.key))
      batch = items
        .filter((i) => retryKeys.has(i.key))
        .map((i) => ({ ...i, phase: 'pending' as const, error: undefined }))
      setItems(items.map((i) => (retryKeys.has(i.key) ? { ...i, phase: 'pending' as const, error: undefined } : i)))
    }
    if (batch.length === 0) {
      setRunning(false)
      return
    }
    // connect once per batch; a wallet problem fails the whole batch cleanly
    let address: string
    try {
      address = await connectWallet()
      await ensureBscChain()
    } catch (e) {
      setBatchError(hireErrorText(e))
      setRunning(false)
      return
    }
    for (const item of batch) {
      setPhase(item.key, 'requirements')
      const outcome = await runHire(item.agent, { address }, (s) => {
        if (s.phase === 'done') setPhase(item.key, 'settled')
        else if (s.phase === 'failed') setPhase(item.key, 'failed', s.error)
        else setPhase(item.key, s.phase)
      })
      // a rejected signature means the user said stop; settled items stay
      if (outcome.cancelled) break
    }
    setRunning(false)
  }

  function hireLine(i: HireItemState): { text: string; tone: string } {
    switch (i.phase) {
      case 'settled':
        return { text: `✓ ${i.name} settled`, tone: 'text-highlighter-green' }
      case 'failed':
        return { text: `failed ${i.name}: ${i.error ?? 'Something went wrong.'}`, tone: 'text-bone-white' }
      case 'signing':
      case 'requirements':
        return { text: `signing ${i.name}...`, tone: 'text-muted-sage' }
      case 'settling':
        return { text: `settling ${i.name}...`, tone: 'text-muted-sage' }
      default:
        return { text: `${i.name} queued`, tone: 'text-muted-sage/60' }
    }
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          className="fixed inset-x-0 bottom-6 z-40 px-4"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={SPRING_STIFF}
        >
          <div className="mx-auto max-w-2xl rounded-[14px] bg-press-black px-6 py-4 text-bone-white shadow-lg">
            <div className="flex items-center justify-between gap-6">
              <span className="micro text-muted-sage">
                {count} {count === 1 ? 'agent' : 'agents'} shortlisted
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={onClear}
                  className="micro text-muted-sage transition hover:text-bone-white focus-visible:outline-2 focus-visible:outline-bone-white"
                >
                  Clear
                </button>
                {hire && hire.winners.length > 0 && (
                  <button
                    type="button"
                    onClick={startHire}
                    disabled={running || allSettled}
                    className="micro rounded-[5px] border hairline border-highlighter-green/60 px-5 py-3 text-highlighter-green transition hover:bg-highlighter-green/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running
                      ? 'Hiring…'
                      : allSettled
                        ? 'Hired'
                        : hire.winners.length === 1
                          ? 'Hire best'
                          : `Hire ${hire.winners.length} best`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCompare}
                  disabled={count < 2}
                  className="micro rounded-[5px] bg-highlighter-green px-5 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Compare {count >= 2 ? `${count} agents` : ''}
                </button>
              </div>
            </div>
            {items.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-bone-white/10 pt-3">
                {batchError && <p className="micro font-mono text-bone-white">{batchError}</p>}
                {items.map((i) => {
                  const line = hireLine(i)
                  return (
                    <p key={i.key} className={`micro font-mono ${line.tone}`} role="status">
                      {line.text}
                    </p>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
