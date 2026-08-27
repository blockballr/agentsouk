import { motion, useReducedMotion } from 'framer-motion'

// animated vector editorial inserts
// the drawn shapes are ink-on-paper elements that carry the site's motion
// vocabulary: strokes draw in, dots settle, orbits drift slowly

const STROKE = { type: 'spring' as const, stiffness: 60, damping: 20 }

function Filter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.svg
      width="220"
      height="150"
      viewBox="0 0 220 150"
      className={`duotone ${className ?? ''}`}
      aria-hidden="true"
    >
      {children}
    </motion.svg>
  )
}

// an architectural arch: two columns and a sweeping top curve draw in, then
// dots trail the door outline continuously, up one leg and down the other
export function ArcTile({ delay = 0 }: { delay?: number }) {
  const reduced = useReducedMotion()
  const trail = !reduced
  const outer = 'M40 130V70a50 50 0 0 1 100 0v60'
  return (
    <Filter className="mx-5 hidden h-auto w-32 align-middle md:inline-block lg:w-40">
      <rect width="220" height="150" fill="#fafffa" />
      <motion.g fill="none" stroke="#121613" strokeWidth="3">
        <motion.path
          d={outer}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ ...STROKE, delay }}
        />
        <motion.path
          d="M60 130V72a30 30 0 0 1 60 0v58"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ ...STROKE, delay: delay + 0.25 }}
        />
        <motion.path
          d="M30 130h120"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ ...STROKE, delay: delay + 0.45 }}
        />
      </motion.g>
      {trail && (
        <>
          <circle r="4" fill="#121613">
            <animateMotion
              dur="8s"
              repeatCount="indefinite"
              begin="1.6s"
              path={outer}
            />
          </circle>
          <circle r="3.5" fill="#121613">
            <animateMotion
              dur="8s"
              repeatCount="indefinite"
              begin="5.6s"
              path={outer}
            />
          </circle>
        </>
      )}
    </Filter>
  )
}

// concentric orbits, dots travelling the rings, centre dot breathing
export function OrbitTile({ delay = 0 }: { delay?: number }) {
  return (
    <Filter className="mx-5 hidden h-auto w-24 align-middle md:inline-block lg:w-32">
      <rect width="220" height="150" fill="#fafffa" />
      <g fill="none" stroke="#121613" strokeWidth="2">
        <circle cx="110" cy="75" r="55" />
        <circle cx="110" cy="75" r="32" />
        <ellipse cx="110" cy="75" rx="70" ry="22" />
      </g>
      <g fill="#121613">
        <circle cx="110" cy="20" r="3" />
        <circle cx="110" cy="130" r="3" />
      </g>
      <motion.circle
        r="4"
        fill="#121613"
        animate={{
          cx: [165, 110, 55, 110],
          cy: [75, 20, 75, 130],
        }}
        transition={{
          delay,
          duration: 14,
          ease: 'linear',
          repeat: Infinity,
          times: [0, 0.25, 0.5, 0.75],
        }}
      />
      <motion.circle
        r="3"
        fill="#121613"
        animate={{
          cx: [55, 110, 165, 110],
          cy: [75, 130, 75, 20],
        }}
        transition={{
          delay: delay + 7,
          duration: 14,
          ease: 'linear',
          repeat: Infinity,
          times: [0, 0.25, 0.5, 0.75],
        }}
      />
      <motion.circle
        cx="110"
        cy="75"
        r="4"
        fill="#121613"
        initial={{ scale: 0 }}
        animate={{ scale: [1, 1.6, 1] }}
        transition={{
          delay,
          duration: 2.4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </Filter>
  )
}

// ledger lines drawing in, a caret landing on each line
export function LedgerTile({ delay = 0 }: { delay?: number }) {
  const lines = ['M30 30h160', 'M30 55h110', 'M30 80h150', 'M30 105h90', 'M30 130h140']
  const dots = [
    { x: 40, y: 30 },
    { x: 50, y: 55 },
    { x: 60, y: 80 },
    { x: 70, y: 105 },
    { x: 80, y: 130 },
  ]
  return (
    <Filter>
      <rect width="220" height="150" fill="#fafffa" />
      <g stroke="#121613" strokeWidth="3" fill="none">
        {lines.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ ...STROKE, delay: delay + i * 0.12 }}
          />
        ))}
      </g>
      {dots.map((p, i) => (
        <motion.circle
          key={`${p.x}-${p.y}`}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="#121613"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...STROKE, delay: delay + 0.3 + i * 0.12 }}
        />
      ))}
    </Filter>
  )
}