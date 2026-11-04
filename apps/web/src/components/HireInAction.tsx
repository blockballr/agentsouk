import { useEffect, useRef } from 'react'
import { Stack } from './souk'
import '../hire-motion.css'

// One funded hire per category, shown at its settled state: the flow complete,
// every event on the record, and the number the move earned. The magnitudes are
// illustrative (the panel says so), because a chart above a hire button reads
// as a promise. The looping animation was retired: a repeated open-to-close
// cycled past the state a buyer needs to see.

type EventPart = { text: string; strong?: boolean }
type Conf = {
  label: string
  nodes: [string, string, string]
  events: EventPart[][]
  start: string
  end: string
}

const CONFIG: Record<string, Conf> = {
  yield: {
    label: 'Yield',
    nodes: ['Buyer', 'Vault', 'Venus'],
    events: [
      [{ text: 'opened · 1.00 USDT' }],
      [{ text: 'supplied to ' }, { text: 'Venus', strong: true }, { text: ' · 57 bps' }],
      [{ text: 'value ' }, { text: '1.0010', strong: true }, { text: ' USDT' }],
      [{ text: 'withdrawn · closed' }],
    ],
    start: '1.0000 USDT',
    end: '1.0010 USDT',
  },
  'grid-trading': {
    label: 'Grid',
    nodes: ['Buyer', 'Vault', 'Pancake'],
    events: [
      [{ text: 'opened · 1.00 USDT' }],
      [{ text: 'rung filled · ' }, { text: 'buy', strong: true }],
      [{ text: 'rung filled · ' }, { text: 'sell', strong: true }],
      [{ text: '3 round trips · closed' }],
    ],
    start: '1.0000 USDT',
    end: '1.0137 USDT',
  },
  rebalancing: {
    label: 'Rebalance',
    nodes: ['Buyer', 'Vault', 'Pancake'],
    events: [
      [{ text: 'opened · 1.00 USDT' }],
      [{ text: 'drift ' }, { text: '8.2%', strong: true }, { text: ' past the band' }],
      [{ text: 'rebalanced to ' }, { text: '50 / 50', strong: true }],
      [{ text: 'closed · 2 trades' }],
    ],
    start: '1.0000 USDT',
    end: '1.0068 USDT',
  },
  'health-factor': {
    label: 'Health factor',
    nodes: ['Buyer', 'Escrow', 'Venus'],
    events: [
      [{ text: 'watch · health factor ' }, { text: '1.33', strong: true }],
      [{ text: 'crossed the guard line' }],
      [{ text: 'repaid ' }, { text: '0.54', strong: true }, { text: ' USDT' }],
      [{ text: 'healthy again · 1.90' }],
    ],
    start: 'HF 1.33',
    end: 'HF 1.90',
  },
}
const MARKS: { f: number; kind: 'buy' | 'sell' }[] = [
  { f: 0.28, kind: 'buy' },
  { f: 0.52, kind: 'sell' },
  { f: 0.74, kind: 'buy' },
]

function chartNode(category: string) {
  if (category === 'yield') {
    return (
      <>
        <path d="M24 112h288" stroke="var(--color-souk-hair)" strokeWidth="1" />
        <path d="M24 92h288M24 72h288M24 52h288" stroke="var(--color-souk-hair)" strokeWidth="1" opacity=".4" />
        <text x="0" y="115" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">1.000</text>
        <text x="0" y="55" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">1.001</text>
        <path data-line stroke="var(--color-souk-sky)" strokeWidth="2" strokeLinecap="round"
          d="M24 112h30v-8h30v-9h30v-8h30v-9h30v-8h30v-9h30v-8h48" />
        <circle data-head cx="282" cy="53" r="3.5" fill="var(--color-souk-sky)" />
      </>
    )
  }
  if (category === 'grid-trading') {
    return (
      <>
        <path d="M24 44h288M24 72h288M24 100h288" stroke="var(--color-souk-hair)" strokeWidth="1" strokeDasharray="3 4" />
        <text x="0" y="47" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">up</text>
        <text x="0" y="103" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">dn</text>
        <path data-price stroke="var(--color-souk-sky)" strokeWidth="2" strokeLinecap="round"
          d="M24 86C44 86 54 58 74 58s26 28 46 28 28-40 48-40 26 44 46 44 28-26 46-26 28 14 44 14" />
      </>
    )
  }
  if (category === 'rebalancing') {
    return (
      <>
        <path d="M24 112h288" stroke="var(--color-souk-hair)" strokeWidth="1" />
        <path d="M24 68h288" stroke="var(--color-souk-muted)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="232" y="64" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">target 50 / 50</text>
        <rect data-bar-a x="76" y="52" width="18" height="60" rx="3" fill="var(--color-souk-sky)" />
        <rect data-bar-b x="102" y="52" width="18" height="60" rx="3" fill="var(--color-souk-peach)" />
        <text x="76" y="126" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">WBNB</text>
        <text x="102" y="126" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">USDT</text>
      </>
    )
  }
  return (
    <>
      <path d="M24 104h288" stroke="var(--color-souk-peach)" strokeWidth="1" strokeDasharray="5 4" opacity=".7" />
      <text x="24" y="120" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">liquidation 1.00</text>
      <path data-hf stroke="var(--color-souk-peach)" strokeWidth="2" strokeLinecap="round"
        d="M24 36C64 38 92 52 120 68s32 34 56 34 24-2 30-2" />
      <path data-repair stroke="var(--color-souk-good)" strokeWidth="2" strokeLinecap="round"
        d="M206 100C232 100 244 56 268 40s28-8 44-8" />
      <circle data-mark cx="206" cy="100" r="3" fill="var(--color-souk-peach)" />
      <text data-low x="176" y="94" fill="var(--color-souk-peach)" fontFamily="ui-monospace, monospace" fontSize="9">1.18</text>
      <text data-high x="268" y="30" fill="var(--color-souk-good)" fontFamily="ui-monospace, monospace" fontSize="9">1.90</text>
    </>
  )
}

export function HireInAction({ category, compact = false, cta }: { category: string; compact?: boolean; cta?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const fills = useRef<SVGGElement>(null)
  const conf = CONFIG[category] ?? CONFIG['grid-trading']

  // the grid markers ride the drawn price path, so their spots come from the
  // path itself, placed once. everything else is settled markup
  useEffect(() => {
    if (category !== 'grid-trading') return
    const host = fills.current
    const price = root.current?.querySelector<SVGPathElement>('[data-price]')
    if (!host || host.childElementCount > 0 || !price) return
    for (const mark of MARKS) {
      const p = price.getPointAtLength(mark.f * price.getTotalLength())
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="var(--color-souk-${mark.kind === 'buy' ? 'sky' : 'peach'})" />
        <text x="${p.x + 6}" y="${p.y - 5}" fill="var(--color-souk-muted)" font-family="ui-monospace, monospace" font-size="8">${mark.kind}</text>`
      host.appendChild(g)
    }
  }, [category])

  return (
    <div ref={root}>
      <Stack surface pad={compact ? [12, 14, 12, 14] : [18, 20, 18, 20]} gap={compact ? 8 : 10}>
        <div className={compact ? 'hia compact' : 'hia'}>
          <div className="hia-head">
            <span className="hia-cat">{conf.label}</span>
          </div>
          <div className="hia-flow">
            {conf.nodes.map((node, i) => (
              <span key={node} className="flex flex-1 items-center gap-1">
                {i > 0 ? <div className="hia-leg" /> : null}
                <div className="hia-node hit">{node}</div>
              </span>
            ))}
          </div>
          <svg className="hia-chart" viewBox="0 0 320 132" fill="none" aria-hidden="true">
            {chartNode(category)}
            {category === 'grid-trading' ? <g data-fills ref={fills} /> : null}
          </svg>
          {compact ? null : (
            <>
              <div className="hia-events">
                {conf.events.map((parts, index) => (
                  <span key={index} className="hia-ev">
                    {parts.map((part, i) =>
                      part.strong ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>,
                    )}
                  </span>
                ))}
              </div>
              <div className="hia-foot">
                <span className="hia-value">{conf.end}</span>
              </div>
              <p className="hia-note">Illustrative magnitudes, not live prices. The receipt is the record.</p>
            </>
          )}
        </div>
        {cta ? (
          <div className="mt-1 flex items-center justify-between border-t border-souk-hair pt-2">
            <span className="font-mono text-[9px] uppercase leading-[13px] tracking-[0.09em] text-souk-labels transition-colors group-hover:text-souk-ink">
              {cta}
            </span>
            <span aria-hidden="true" className="font-mono text-[13px] leading-none text-souk-sky transition-transform group-hover:translate-x-1">
              →
            </span>
          </div>
        ) : null}
      </Stack>
    </div>
  )
}
