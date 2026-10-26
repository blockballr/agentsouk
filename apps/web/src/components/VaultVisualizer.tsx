import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

// A fun, self-contained vault visualizer. Drop it anywhere with vault state;
// with no state it runs a demo loop so the shape of it is visible at once.
export interface VaultVisualizerState {
  labelA?: string
  labelB?: string
  balanceA?: number
  balanceB?: number
  valueUsd?: number
  floorUsd?: number
  maxLossBps?: number
  maxSlippageBps?: number
  drawdownUsedBps?: number
  price?: number
  trades?: { side: 'A' | 'B'; amount: number; ts?: number }[]
}

const DEFAULTS: Required<VaultVisualizerState> = {
  labelA: 'Token A',
  labelB: 'Token B',
  balanceA: 60,
  balanceB: 40,
  valueUsd: 10000,
  floorUsd: 9000,
  maxLossBps: 500,
  maxSlippageBps: 100,
  drawdownUsedBps: 120,
  price: 1.0,
  trades: [
    { side: 'A', amount: 1200 },
    { side: 'B', amount: 800 },
    { side: 'A', amount: 400 },
  ],
}

export function VaultVisualizer({ state }: { state?: VaultVisualizerState }) {
  const s = { ...DEFAULTS, ...state }
  const total = Math.max(1, s.balanceA + s.balanceB)
  const pctA = (s.balanceA / total) * 100
  const pctB = 100 - pctA
  const floorPct = Math.min(100, Math.max(0, (s.floorUsd / Math.max(1, s.valueUsd)) * 100))
  const drawdownPct = Math.min(100, (s.drawdownUsedBps / Math.max(1, s.maxLossBps)) * 100)
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => (p + 1) % 4), 1200)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="relative overflow-hidden rounded-[16px] border border-souk-hair bg-gradient-to-br from-souk-surface1 to-souk-surface2 p-5">
      {/* vault door header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: [0, 6, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="text-2xl"
          >
            🔐
          </motion.div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-souk-muted">HireVault</div>
            <div className="text-[13px] font-semibold text-souk-ink">Position vault</div>
          </div>
        </div>
        <div className="rounded-full border border-souk-data/40 bg-souk-data/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-souk-data">
          live
        </div>
      </div>

      {/* two liquid bars */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-souk-muted">
            <span>{s.labelA}</span>
            <span className="font-mono text-souk-ink">{s.balanceA.toFixed(2)}</span>
          </div>
          <div className="relative h-24 overflow-hidden rounded-[10px] border border-souk-hair bg-souk-surface2">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${pctA}%` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-souk-indigo to-souk-sky"
            />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-difference">
              {pctA.toFixed(0)}%
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-souk-muted">
            <span>{s.labelB}</span>
            <span className="font-mono text-souk-ink">{s.balanceB.toFixed(2)}</span>
          </div>
          <div className="relative h-24 overflow-hidden rounded-[10px] border border-souk-hair bg-souk-surface2">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${pctB}%` }}
              transition={{ duration: 1.2, ease: 'easeOut', delay: 0.15 }}
              className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-souk-peach to-souk-warn"
            />
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-difference">
              {pctB.toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* floor gauge */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-souk-muted">
          <span>Value vs floor</span>
          <span className="font-mono text-souk-ink">
            ${s.valueUsd.toLocaleString()} / ${s.floorUsd.toLocaleString()}
          </span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full border border-souk-hair bg-souk-surface2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${floorPct}%` }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-souk-data via-souk-sky to-souk-indigo"
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-souk-warn"
            style={{ left: `${floorPct}%` }}
            title="floor"
          />
        </div>
        <div className="mt-1 flex justify-between text-[9px] uppercase tracking-[0.08em] text-souk-muted">
          <span>0</span>
          <span className="text-souk-warn">floor {floorPct.toFixed(0)}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* drawdown fuel gauge */}
      <div className="mt-4 flex items-center gap-3">
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="6" className="text-souk-hair" />
            <motion.circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              className={drawdownPct > 80 ? 'text-souk-warn' : 'text-souk-data'}
              initial={{ strokeDasharray: '0 200' }}
              animate={{ strokeDasharray: `${(drawdownPct / 100) * 163} 200` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[11px] font-bold text-souk-ink">{drawdownPct.toFixed(0)}%</span>
            <span className="text-[8px] uppercase tracking-[0.06em] text-souk-muted">drawdown</span>
          </div>
        </div>
        <div className="flex-1 text-[11px] text-souk-muted">
          <div>max loss: {s.maxLossBps} bps</div>
          <div>max slippage: {s.maxSlippageBps} bps</div>
          <div>price: {s.price.toFixed(4)}</div>
          <div className="mt-1 text-souk-ink">guard: {drawdownPct > 80 ? '⚠ near limit' : '✓ within bounds'}</div>
        </div>
      </div>

      {/* trade chips */}
      <div className="mt-4">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-souk-muted">recent trades</div>
        <div className="flex flex-wrap gap-2">
          {s.trades.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.12 }}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${t.side === 'A' ? 'border-souk-indigo/40 text-souk-indigo' : 'border-souk-peach/40 text-souk-peach'}`}
            >
              {t.side === 'A' ? '↓ buy A' : '↑ buy B'} {t.amount}
            </motion.div>
          ))}
          {s.trades.length === 0 && <span className="text-[10px] text-souk-muted">no trades yet</span>}
        </div>
      </div>

      {/* pulse indicator */}
      <div className="mt-3 flex items-center gap-1">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            animate={{ opacity: i === pulse ? 1 : 0.25, scale: i === pulse ? 1.3 : 1 }}
            transition={{ duration: 0.3 }}
            className="inline-block h-1.5 w-1.5 rounded-full bg-souk-data"
          />
        ))}
        <span className="ml-2 text-[9px] uppercase tracking-[0.08em] text-souk-muted">live</span>
      </div>
    </div>
  )
}

export default VaultVisualizer