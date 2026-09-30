import type { ReactNode } from 'react'

// a quiet fact about an agent; plain case on purpose, so x402 and sUSD read as written
export function Tag({ title, href, children }: { title?: string; href?: string; children: ReactNode }) {
  const cls =
    'inline-flex items-center rounded-full border hairline border-slate-verdant/35 px-2 py-0.5 text-[11px] font-[550] tracking-[0.01em] text-newsprint-gray'
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={title} className={`${cls} transition hover:border-press-black/50 hover:text-press-black`}>
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
