import type { ReactNode } from 'react'

// a quiet fact about an agent; plain case on purpose, so x402 and sUSD read as written.
// Squared like the design's chips rather than a pill, and on the card surface so it sits
// in the dark system the ported screens now use.
export function Tag({ title, href, children }: { title?: string; href?: string; children: ReactNode }) {
  const cls =
    'inline-flex items-center rounded-[6px] border border-souk-hair bg-souk-surface1 px-2 py-0.5 text-[11px] font-semibold tracking-[0.01em] text-souk-steel'
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title} className={`${cls} transition hover:border-souk-data/40 hover:text-souk-ink`}>
        {children}
      </a>
    )
  }
  return (
    <span title={title} className={cls}>
      {children}
    </span>
  )
}
