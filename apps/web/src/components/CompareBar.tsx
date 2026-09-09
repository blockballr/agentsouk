import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { connectWallet, ensureBscChain } from '../lib/wallet'
import { hireErrorText, runHire, type HireAgentRef } from '../lib/hire'
import { getAgentDetail } from '../lib/api'
import { addToCart, clearCart } from '../lib/cart'
import { categoryOf } from '../lib/compare'
import { getShortlist } from '../lib/shortlist'

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

// floating compare shortlist bar, shared by the marketplace and the compare
// page; pages decide when to mount it, what the Compare action does, and
// whether the "Hire best" action is available (compare page passes winners
// from the best-in-category ranker; the marketplace passes nothing)
export function CompareBar({
  count,
  ids,
  onClear,
  onCompare,
  hire,
  cartNoun = 'agents',
}: {
  count: number
  // shortlist ids backing the bar; pages that hold them in state pass them
  // in, otherwise the bar reads the persisted shortlist itself
  ids?: string[]
  onClear: () => void
  onCompare: () => void
  // the agents the buttons act on: checked selection on the compare table,
  // bests-of-shortlist on the marketplace; drives both the primary add-to-cart
  // and the secondary direct hire
  hire?: { winners: HireAgentRef[] }
  // noun for the primary button: "Add N agents to cart" vs "Add N best to cart"
  cartNoun?: 'agents' | 'best'
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

  // legacy whole-shortlist add (cart icon / no target set)
  async function startAddToCart() {
    if (cartBusy) return
    const batch = ids ?? getShortlist()
    if (batch.length === 0) return
    setCartBusy(true)
    setCartPhase('adding')
    let full = false
    let failed = false
    for (const id of batch) {
      const [chainId = '56', tokenId = id] = id.split('/')
      try {
        const d = await getAgentDetail(chainId, tokenId)
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

  // clear wipes everything hire-related: shortlist (page callback), cart, and
  // the failure strip; no stale "failed ..." lines after clear + reselect
  function handleClear() {
    setItems([])
    setBatchError(null)
    clearCart()
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
    }
    setRunning(false)
  }

  function CartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      width="16"
      height="16"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 4h2l2.4 11.2a1.6 1.6 0 0 0 1.57 1.3h7.9a1.6 1.6 0 0 0 1.56-1.22L20.5 8H6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
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
          <div className="mx-auto max-w-2xl rounded-[14px] bg-press-black px-6 py-4 text-bone-white shadow-lg">
            <div className="flex items-center justify-between gap-6">
              <span className="micro text-muted-sage">
                {count} {count === 1 ? 'agent' : 'agents'} shortlisted
              </span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleClear}
                  className="micro text-muted-sage transition hover:text-bone-white focus-visible:outline-2 focus-visible:outline-bone-white"
                >
                  Clear
                </button>
                {hire && (
                  <>
                    <button
                      type="button"
                      onClick={() => startAddToCartRefs(hire.winners)}
                      disabled={cartBusy || hire.winners.length === 0}
                      title={
                        hire.winners.length === 0
                          ? 'Select agents with the checkboxes in the compare table'
                          : undefined
                      }
                      className="micro rounded-[5px] bg-highlighter-green px-5 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {cartPhase === 'adding'
                        ? 'Adding…'
                        : cartPhase === 'added'
                          ? '✓ Added'
                          : cartPhase === 'full'
                            ? 'Cart full'
                            : cartPhase === 'error'
                              ? 'Failed, retry'
                              : `Add ${hire.winners.length} ${cartNoun} to cart`}
                    </button>
                    <button
                      type="button"
                      onClick={startHire}
                      disabled={running || allSettled || hire.winners.length === 0}
                      title={
                        hire.winners.length === 0
                          ? 'Select agents with the checkboxes in the compare table'
                          : undefined
                      }
                      className="micro rounded-[5px] border hairline border-highlighter-green/60 px-5 py-3 text-highlighter-green transition hover:bg-highlighter-green/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {running
                        ? 'Hiring…'
                        : allSettled
                          ? 'Hired'
                          : hire.winners.length === 1
                            ? 'Hire 1 selected'
                            : `Hire ${hire.winners.length} selected`}
                    </button>
                  </>
                )}
                {(ids ?? getShortlist()).length > 0 && (
                  <button
                    type="button"
                    onClick={startAddToCart}
                    disabled={cartBusy}
                    aria-label={`Add all ${count} shortlisted agents to cart`}
                    className="micro inline-flex items-center gap-2 rounded-[5px] border hairline border-bone-white/30 px-3.5 py-3 text-muted-sage transition hover:border-bone-white/60 hover:text-bone-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {cartPhase === 'idle' && <CartIcon className="h-4 w-4" />}
                    {cartPhase === 'adding' && 'Adding…'}
                    {cartPhase === 'added' && '✓ Added'}
                    {cartPhase === 'full' && 'Cart full'}
                    {cartPhase === 'error' && 'Failed, try again'}
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
