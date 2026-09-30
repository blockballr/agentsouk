import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { connectWallet, ensureBscChain } from '../lib/wallet'
import { hireErrorText, runHire, type HireAgentRef } from '../lib/hire'
import { getAgentDetail } from '../lib/api'
import { addToCart, removeFromCart } from '../lib/cart'
import { categoryOf } from '../lib/compare'
import { removeFromShortlist } from '../lib/shortlist'

type CartPhase = 'idle' | 'adding' | 'added' | 'full' | 'error'

type HireItemPhase = 'pending' | 'requirements' | 'signing' | 'settling' | 'settled' | 'failed'

interface HireItemState {
  key: string
  name: string
  agent: HireAgentRef
  phase: HireItemPhase
  error?: string
}

const hireKey = (a: HireAgentRef) => `${a.chainId}/${a.tokenId}`

// mount: a single tight spring that lands with a subtle overshoot; exit:
// a short tween. under prefers-reduced-motion everything is opacity-only
const SPRING_POP = { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as const
const EXIT_TWEEN = { type: 'tween', duration: 0.18, ease: 'easeOut' } as const

// floating compare shortlist bar, shared by the marketplace and the compare page;
// pages decide when to mount it, what the actions do, and whether Hire best is available
export function CompareBar({
  count,
  ids,
  onClear,
  onCompare,
  onHired,
  hire,
}: {
  count: number
  // shortlist ids backing the bar; pages that hold them in state pass them
  // in, otherwise the bar reads the persisted shortlist itself
  ids?: string[]
  onClear: () => void
  onCompare: () => void
  // settle success: drop hired agents from the page shortlist so the bar count
  // tracks what is left, not what was hired
  onHired?: (keys: string[]) => void
  // the agents the buttons act on: checked selection on the compare table, bests-of-shortlist
  // on the marketplace; drives the primary add-to-cart and the secondary direct hire
  hire?: { winners: HireAgentRef[] }
}) {
  const [items, setItems] = useState<HireItemState[]>([])
  const [batchError, setBatchError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [cartPhase, setCartPhase] = useState<CartPhase>('idle')
  const [cartBusy, setCartBusy] = useState(false)
  const reducedMotion = useReducedMotion()

  const allSettled = items.length > 0 && items.every((i) => i.phase === 'settled')

  // one detail fetch per agent (the cart needs the category), then into the
  // existing cart api; full/failed surfaces briefly on the button
  async function startAddToCartRefs(refs: HireAgentRef[]) {
    if (cartBusy || refs.length === 0) return
    setCartBusy(true)
    setCartPhase('adding')
    let full = false
    let failed = false
    for (const r of refs) {
      try {
        const d = await getAgentDetail(String(r.chainId), String(r.tokenId))
        if (!d) {
          failed = true
          continue
        }
        const res = addToCart({
          chainId: d.chain_id,
          tokenId: Number(d.token_id),
          name: d.name,
          category: categoryOf(d),
        })
        if (res === 'full') full = true
      } catch {
        failed = true
      }
    }
    setCartBusy(false)
    setCartPhase(failed ? 'error' : full ? 'full' : 'added')
    window.setTimeout(() => setCartPhase('idle'), 1800)
  }

  function setPhase(key: string, phase: HireItemPhase, error?: string) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, phase, error } : i)))
  }

  // clear drops the shortlist and the failure strip; the cart is filled on its own
  // from each card, so clearing a comparison never empties it
  function handleClear() {
    setItems([])
    setBatchError(null)
    onClear()
  }

  // failed lines auto-dismiss ~10s after the batch stops; a new attempt
  // re-batches them immediately, so the strip never lingers
  useEffect(() => {
    if (running) return
    const hasFailure = batchError !== null || items.some((i) => i.phase === 'failed')
    if (!hasFailure) return
    const t = window.setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.phase !== 'failed'))
      setBatchError(null)
    }, 10000)
    return () => window.clearTimeout(t)
  }, [items, batchError, running])

  // the strip (and any settled/queued lines) belong to the hire attempt for a
  // given shortlist; a changed shortlist drops them even without Clear
  const shortlistKey = (ids ?? []).join(',')
  useEffect(() => {
    setItems([])
    setBatchError(null)
  }, [shortlistKey])

  async function startHire() {
    if (!hire || hire.winners.length === 0 || running || allSettled) return
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
      if (outcome.success) {
        // direct hire is a completed checkout: drop the agent from cart and
        // shortlist so the bar does not keep a hired count around
        removeFromCart(item.agent.chainId, item.agent.tokenId)
        removeFromShortlist([item.key])
        onHired?.([item.key])
      }
    }
    setRunning(false)
  }

function hireLine(i: HireItemState): { text: string; tone: string } {
    switch (i.phase) {
      case 'settled':
        return { text: `✓ ${i.name} settled`, tone: 'text-highlighter-green' }
      case 'failed':
        return { text: `failed ${i.name}: ${i.error ?? 'Something went wrong.'}`, tone: 'text-night-ink' }
      case 'signing':
      case 'requirements':
        return { text: `signing ${i.name}...`, tone: 'text-night-muted' }
      case 'settling':
        return { text: `settling ${i.name}...`, tone: 'text-night-muted' }
      default:
        return { text: `${i.name} queued`, tone: 'text-night-muted/60' }
    }
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          className="fixed inset-x-0 bottom-6 z-40 origin-bottom px-4"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.94 }}
          animate={
            reducedMotion
              ? { opacity: 1, transition: { duration: 0.2 } }
              : { opacity: 1, y: 0, scale: 1, transition: SPRING_POP }
          }
          exit={
            reducedMotion
              ? { opacity: 0, transition: { duration: 0.15 } }
              : { opacity: 0, y: 32, scale: 0.96, transition: EXIT_TWEEN }
          }
        >
          <div className="mx-auto max-w-2xl rounded-[14px] bg-night ring-1 ring-white/10 px-5 py-3.5 text-night-ink shadow-lg sm:px-6">
            {/* one main action per place: compare from the shortlist, add to cart from the table */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <span className="micro text-night-muted">
                {hire
                  ? `${hire.winners.length} of ${count} selected for hire`
                  : `${count} ${count === 1 ? 'agent' : 'agents'} to compare`}
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleClear}
                  className="micro min-h-11 text-night-muted transition hover:text-night-ink focus-visible:outline-2 focus-visible:outline-night-ink sm:min-h-0"
                >
                  Clear
                </button>
                {hire ? (
                  <>
                    <button
                      type="button"
                      onClick={startHire}
                      disabled={running || allSettled || hire.winners.length === 0}
                      title="Sign and pay for each selected agent now, without the cart"
                      className="micro min-h-11 text-night-muted underline decoration-night-muted/50 underline-offset-4 transition hover:text-night-ink focus-visible:outline-2 focus-visible:outline-night-ink disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
                    >
                      {running ? 'Hiring…' : allSettled ? 'Hired' : 'Hire now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => startAddToCartRefs(hire.winners)}
                      disabled={cartBusy || hire.winners.length === 0}
                      title={hire.winners.length === 0 ? 'Tick Include in hire on an agent in the table' : undefined}
                      className="gloss micro rounded-[5px] bg-highlighter-green px-5 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-night-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {cartPhase === 'adding'
                        ? 'Adding…'
                        : cartPhase === 'added'
                          ? '✓ Added'
                          : cartPhase === 'full'
                            ? 'Cart full'
                            : cartPhase === 'error'
                              ? 'Failed, retry'
                              : `Add ${hire.winners.length} to cart`}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={onCompare}
                    disabled={count < 2}
                    title={count < 2 ? 'Pick one more agent to compare' : undefined}
                    className="gloss micro rounded-[5px] bg-highlighter-green px-5 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-night-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {count < 2 ? 'Pick one more' : `Compare ${count}`}
                  </button>
                )}
              </div>
            </div>
            {items.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
                {batchError && <p className="micro font-mono text-night-ink">{batchError}</p>}
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
