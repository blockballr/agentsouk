import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Stack } from './souk'
import '../hire-motion.css'

// one funded hire per category, two modes. the default is settled state: the
// flow complete, every event on the record, and the number the move earned,
// so marketplace reads it without motion. motion renders the old open-to-close
// loop instead: events firing one by one, dots on the legs, the value rolling,
// staggered per card with delay. both keep the cta chip and the group hover.
// magnitudes are illustrative in both, because a chart above a hire button
// reads as a promise.

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

// the settled chart: lines and bars already at their final form
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

// the looping chart: lines and bars at their open state, drawn over the cycle
function chartFor(category: string) {
  if (category === 'yield') {
    return (
      <>
        <path d="M24 112h288" stroke="var(--color-souk-hair)" strokeWidth="1" />
        <path d="M24 92h288M24 72h288M24 52h288" stroke="var(--color-souk-hair)" strokeWidth="1" opacity=".4" />
        <text x="0" y="115" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">1.000</text>
        <text x="0" y="55" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">1.001</text>
        <path data-line stroke="var(--color-souk-sky)" strokeWidth="2" strokeLinecap="round"
          d="M24 112h30v-8h30v-9h30v-8h30v-9h30v-8h30v-9h30v-8h48" />
        <circle data-head cx="24" cy="112" r="3.5" fill="var(--color-souk-sky)" />
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
        <g data-fills />
      </>
    )
  }
  if (category === 'rebalancing') {
    return (
      <>
        <path d="M24 112h288" stroke="var(--color-souk-hair)" strokeWidth="1" />
        <path d="M24 68h288" stroke="var(--color-souk-muted)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="232" y="64" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">target 50 / 50</text>
        <rect data-bar-a x="76" y="40" width="18" height="72" rx="3" fill="var(--color-souk-sky)" />
        <rect data-bar-b x="102" y="68" width="18" height="44" rx="3" fill="var(--color-souk-peach)" />
        <text x="76" y="126" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">WBNB</text>
        <text x="102" y="126" fill="var(--color-souk-muted)" fontFamily="ui-monospace, monospace" fontSize="8">USDT</text>
        <text data-gap x="146" y="60" fill="var(--color-souk-peach)" fontFamily="ui-monospace, monospace" fontSize="9">8.2% drift</text>
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
      <circle data-mark cx="206" cy="100" r="3" fill="var(--color-souk-peach)" opacity="0" />
      <text data-low x="176" y="94" fill="var(--color-souk-peach)" fontFamily="ui-monospace, monospace" fontSize="9" opacity="0">1.18</text>
      <text data-high x="268" y="30" fill="var(--color-souk-good)" fontFamily="ui-monospace, monospace" fontSize="9" opacity="0">1.90</text>
    </>
  )
}

function ctaRow(cta?: string) {
  if (!cta) return null
  return (
    <div className="mt-1 flex items-center justify-between border-t border-souk-hair pt-2">
      <span className="font-mono text-[9px] uppercase leading-[13px] tracking-[0.09em] text-souk-labels transition-colors group-hover:text-souk-ink">
        {cta}
      </span>
      <span aria-hidden="true" className="font-mono text-[13px] leading-none text-souk-sky transition-transform group-hover:translate-x-1">
        →
      </span>
    </div>
  )
}

export function HireInAction({ category, compact = false, cta, motion = false, delay = 0 }: { category: string; compact?: boolean; cta?: string; motion?: boolean; delay?: number }) {
  const root = useRef<HTMLDivElement>(null)
  const fills = useRef<SVGGElement>(null)
  const conf = CONFIG[category] ?? CONFIG['grid-trading']

  // motion: the recovered open-to-close loop, played by the timeline once per
  // mount. falls back to the first frame under prefers-reduced-motion.
  useEffect(() => {
    if (!motion) return
    const host = root.current
    if (!host) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      const q = (sel: string) => host.querySelector(sel) as SVGElement | null
      const ev = gsap.utils.toArray<HTMLElement>(host.querySelectorAll('.hia-ev'))
      const nodes = gsap.utils.toArray<HTMLElement>(host.querySelectorAll('.hia-node'))
      const dots = gsap.utils.toArray<HTMLElement>(host.querySelectorAll('.hia-dot'))
      const value = host.querySelector('.hia-value') as HTMLElement | null
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4, paused: true })
      const counter = { v: 1 }

      gsap.set(ev, { opacity: 0, y: 4 })
      const show = (i: number, at: number) => tl.to(ev[i], { opacity: 1, y: 0, duration: 0.28 }, at)
      const leg = (dot: HTMLElement, at: number) => {
        gsap.set(dot, { x: 0, opacity: 1 })
        tl.to(dot, { x: 38, duration: 0.7, ease: 'power2.inOut' }, at)
      }
      const hit = (i: number, at: number) => tl.call(() => nodes[i]?.classList.add('hit'), [], at)
      const draw = (el: SVGElement | null, duration: number, onProgress?: (p: number) => void) => {
        if (!el) return
        const len = (el as SVGPathElement).getTotalLength()
        gsap.set(el, { strokeDasharray: len, strokeDashoffset: len })
        tl.to(el, {
          strokeDashoffset: 0,
          duration,
          ease: 'none',
          onUpdate() {
            const offset = Number(el.getAttribute('stroke-dashoffset') ?? 0)
            onProgress?.(1 - offset / len)
          },
        }, 2)
      }

      tl.call(() => {
        nodes.forEach((n) => n.classList.remove('hit'))
        dots.forEach((d) => gsap.set(d, { x: 0, opacity: 0 }))
        if (value) value.textContent = conf.start
        if (category === 'rebalancing') {
          gsap.set(q('[data-bar-a]'), { attr: { y: 40, height: 72 } })
          gsap.set(q('[data-bar-b]'), { attr: { y: 68, height: 44 } })
          gsap.set(q('[data-gap]'), { opacity: 1 })
        }
        if (category === 'health-factor') {
          gsap.set([q('[data-mark]'), q('[data-low]'), q('[data-high]')], { opacity: 0 })
        }
        if (category === 'grid-trading') {
          host.querySelectorAll('[data-fills] g').forEach((g) => g.setAttribute('opacity', '0'))
        }
      })

      show(0, 0.05)
      leg(dots[0], 0.15)
      hit(1, 0.9)
      if (category !== 'health-factor') show(1, 1.2)
      leg(dots[1], 1.15)
      hit(2, 1.8)

      if (category === 'yield') {
        const head = q('[data-head]')
        draw(q('[data-line]'), 2.6, (p) => {
          const line = q('[data-line]') as SVGPathElement
          const point = line.getPointAtLength(p * line.getTotalLength())
          gsap.set(head, { attr: { cx: point.x, cy: point.y } })
          if (value) value.textContent = `${(1 + 0.001 * p).toFixed(4)} USDT`
        })
        show(2, 3.9)
        show(3, 5.0)
      }

      if (category === 'grid-trading') {
        const price = q('[data-price]') as SVGPathElement | null
        const fillsHost = host.querySelector('[data-fills]')
        if (price && fillsHost && fillsHost.childElementCount === 0) {
          MARKS.forEach((m) => {
            const p = price.getPointAtLength(m.f * price.getTotalLength())
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
            g.setAttribute('opacity', '0')
            g.innerHTML = `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="var(--color-souk-${m.kind === 'buy' ? 'sky' : 'peach'})" />
              <text x="${p.x + 6}" y="${p.y - 5}" fill="var(--color-souk-muted)" font-family="ui-monospace, monospace" font-size="8">${m.kind}</text>`
            fillsHost.appendChild(g)
          })
        }
        draw(q('[data-price]'), 3, (p) => {
          if (value) value.textContent = `${(1 + 0.0137 * p).toFixed(4)} USDT`
          host.querySelectorAll('[data-fills] g').forEach((g, i) => {
            if (p >= [0.28, 0.52, 0.74][i]) g.setAttribute('opacity', '1')
          })
        })
        show(2, 3.2)
        show(3, 4.6)
      }

      if (category === 'rebalancing') {
        tl.to(q('[data-bar-a]'), { attr: { y: 52, height: 60 }, duration: 1.1, ease: 'power2.inOut' }, 2.1)
        tl.to(q('[data-bar-b]'), { attr: { y: 52, height: 60 }, duration: 1.1, ease: 'power2.inOut' }, 2.1)
        tl.to(q('[data-gap]'), { opacity: 0, duration: 0.3 }, 2.1)
        show(2, 3.2)
        tl.to(counter, {
          v: 1.0068,
          duration: 1.4,
          onUpdate() {
            if (value) value.textContent = `${counter.v.toFixed(4)} USDT`
          },
        }, 3.2)
        show(3, 4.6)
      }

      if (category === 'health-factor') {
        draw(q('[data-hf]'), 1.8)
        show(1, 1.8)
        tl.call(() => {
          gsap.to([q('[data-mark]'), q('[data-low]')], { opacity: 1, duration: 0.25 })
          if (value) value.textContent = 'HF 1.18'
        }, [], 2.5)
        show(2, 2.6)
        draw(q('[data-repair]'), 1.5)
        tl.call(() => {
          gsap.to(q('[data-high]'), { opacity: 1, duration: 0.25 })
          if (value) value.textContent = conf.end
        }, [], 4.2)
        show(3, 4.6)
      }

      tl.to(ev, { opacity: 0, duration: 0.18 }, 5.7)
      if (delay > 0) gsap.delayedCall(delay, () => tl.play())
      else tl.play()
    }, host)

    return () => ctx.revert()
  }, [motion, category, conf, compact, delay])

  // static: the grid markers ride the drawn price path, so their spots come
  // from the path itself, placed once. everything else is settled markup
  useEffect(() => {
    if (motion) return
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
  }, [motion, category])

  if (motion) {
    return (
      <div ref={root} className="hia-motion">
        <Stack surface pad={compact ? [12, 14, 12, 14] : [18, 20, 18, 20]} gap={compact ? 8 : 10}>
          <div className={compact ? 'hia compact' : 'hia'}>
            <div className="hia-head">
              <span className="hia-cat">{conf.label}</span>
            </div>
            <div className="hia-flow">
              <div className="hia-node">{conf.nodes[0]}</div>
              <div className="hia-leg"><span className="hia-dot" /></div>
              <div className="hia-node">{conf.nodes[1]}</div>
              <div className="hia-leg"><span className="hia-dot" /></div>
              <div className="hia-node">{conf.nodes[2]}</div>
            </div>
            <svg className="hia-chart" viewBox="0 0 320 132" fill="none" aria-hidden="true">
              {chartFor(category)}
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
                  <span className="hia-value">{conf.start}</span>
                </div>
                <p className="hia-note">Illustrative magnitudes, not live prices. The receipt is the record.</p>
              </>
            )}
          </div>
          {ctaRow(cta)}
        </Stack>
      </div>
    )
  }

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
        {ctaRow(cta)}
      </Stack>
    </div>
  )
}
