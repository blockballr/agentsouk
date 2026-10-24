import { useId } from 'react'
import { formatCompact, type EarningsPoint } from '../lib/earnings'
import { Txt } from './souk'

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
  const gradientId = useId().replace(/:/g, '')
  const W = 720
  const H = 260
  const PAD = 10
  const values = points.length > 0 ? points.map((p) => p.v) : [0]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const spread = high - low
  const empty = values.every((v) => Math.abs(v) < 1e-9)
  let min: number
  let max: number
  if (low === 0 && high === 0) {
    min = 0
    max = 1
  } else {
    const margin = spread === 0 ? Math.max(1, Math.abs(high) * 0.04) : spread * 0.08
    // Cumulative settled earnings cannot sit below zero. Start the axis at zero
    // instead of drawing a negative margin under a line that never goes there.
    min = low >= 0 ? 0 : low - margin
    max = high > 0 ? high + margin : margin
  }
  const span = max - min || 1
  const from = points[0]?.t ?? 0
  const to = points[points.length - 1]?.t ?? from
  const width = to - from || 1

  const x = (t: number) => ((t - from) / width) * W
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join(' ')
  const area = `${line} L${x(to).toFixed(1)} ${H - PAD} L${x(from).toFixed(1)} ${H - PAD} Z`
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4).reverse()
  const xTicks = Array.from({ length: 5 }, (_, i) => (W * i) / 4)
  const lastV = values[values.length - 1] ?? 0
  const tone = empty ? 'text-souk-muted' : lastV < 0 ? 'text-souk-peach' : 'text-souk-data'

  return (
    <div className={`flex min-h-0 gap-3 ${className}`}>
      <div className="relative h-full w-14 shrink-0">
        {ticks.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="absolute right-0 -translate-y-1/2 font-mono text-[9px] leading-none tabular-nums text-souk-muted"
            style={{ top: `${(y(t) / H) * 100}%` }}
          >
            {formatCompact(t)}
          </span>
        ))}
      </div>
      <div className="relative h-full min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={`h-full w-full overflow-visible ${tone}`}
          role="img"
          aria-label={
            empty
              ? 'Cumulative settled earnings, none settled yet'
              : `Cumulative settled earnings, ${formatCompact(lastV)} at the latest point`
          }
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="currentColor" strokeOpacity="0.035" vectorEffect="non-scaling-stroke">
            {xTicks.map((t, i) => (
              <line
                key={`x-${i}`}
                x1={t}
                y1={PAD}
                x2={t}
                y2={H - PAD}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g stroke="currentColor" strokeOpacity="0.09" strokeDasharray="2 5">
            {ticks.map((t, i) => (
              <line
                key={`y-${i}`}
                x1="0"
                y1={y(t)}
                x2={W}
                y2={y(t)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {min < 0 && max > 0 ? (
            <line
              x1="0"
              y1={y(0)}
              x2={W}
              y2={y(0)}
              stroke="currentColor"
              strokeOpacity="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {!empty ? <path d={area} fill={`url(#${gradientId})`} /> : null}
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={empty ? '4 6' : undefined}
            strokeOpacity={empty ? 0.5 : 1}
            vectorEffect="non-scaling-stroke"
          />
          {!empty ? (
            <g>
              <circle cx={x(to)} cy={y(lastV)} r={7} fill="currentColor" opacity="0.14" />
              <circle
                cx={x(to)}
                cy={y(lastV)}
                r={3.5}
                fill="currentColor"
                stroke="var(--color-souk-canvas)"
                strokeWidth={1.5}
              />
            </g>
          ) : null}
        </svg>
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Txt size={11} lead={16} mono upper tone="muted">
              No settled earnings yet
            </Txt>
          </div>
        ) : null}
      </div>
    </div>
  )
}
