import { formatCompact, type EarningsPoint } from '../lib/earnings'

// The cumulative line on its own: the portfolio chart reads it, and any other
// surface that needs a settled-earnings line can render the same component with
// the same points. The parent gives it a height; the SVG fills it.
export function EarningsChart({
  points,
  className = '',
}: {
  points: EarningsPoint[]
  className?: string
}) {
  const W = 720
  const H = 260
  const PAD = 8
  const values = points.map((p) => p.v)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const spread = high - low
  let min: number
  let max: number
  if (low === 0 && high === 0) {
    min = 0
    max = 1
  } else {
    const margin = spread === 0 ? Math.max(1, Math.abs(high) * 0.04) : spread * 0.08
    min = Math.min(0, low) - margin
    max = Math.max(0, high) + margin
  }
  const span = max - min || 1
  const from = points[0].t
  const to = points[points.length - 1].t
  const width = to - from || 1

  const x = (t: number) => ((t - from) / width) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(to).toFixed(1)} ${H - PAD} L${x(from).toFixed(1)} ${H - PAD} Z`
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4).reverse()
  const lastV = points[points.length - 1].v

  return (
    <div className={`flex min-h-0 gap-2 ${className}`}>
      <div className="relative h-full w-12 shrink-0">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 -translate-y-1/2 font-mono text-[9px] leading-none text-souk-muted"
            style={{ top: `${(y(t) / H) * 100}%` }}
          >
            {formatCompact(t)}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full min-w-0 flex-1 text-souk-data"
        role="img"
        aria-label="Cumulative settled earnings"
      >
        <defs>
          <linearGradient id="earnings-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="currentColor" strokeOpacity="0.1" strokeDasharray="2 4" className="text-souk-muted">
          {ticks.map((t) => (
            <line key={t} x1="0" y1={y(t)} x2={W} y2={y(t)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {min < 0 && max > 0 ? (
          <line
            x1="0"
            y1={y(0)}
            x2={W}
            y2={y(0)}
            stroke="currentColor"
            strokeOpacity="0.32"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path d={area} fill="url(#earnings-fill)" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(to)} cy={y(lastV)} r={3.5} fill="currentColor" stroke="var(--color-souk-canvas)" strokeWidth={1.5} />
      </svg>
    </div>
  )
}
