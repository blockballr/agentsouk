import { AnimatePresence, motion } from 'framer-motion'
import { SPRING_STIFF } from '../lib/motion'

// floating compare shortlist bar, shared by the marketplace and the compare
// page; pages decide when to mount it and what the Compare action does
export function CompareBar({
  count,
  onClear,
  onCompare,
}: {
  count: number
  onClear: () => void
  onCompare: () => void
}) {
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
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-6 rounded-[14px] bg-press-black px-6 py-4 text-bone-white shadow-lg">
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
        </motion.div>
      )}
    </AnimatePresence>
  )
}
