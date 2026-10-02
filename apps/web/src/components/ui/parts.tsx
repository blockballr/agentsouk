import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { button, cx, LABEL, type ButtonSize, type ButtonVariant } from './recipes'

// one button shape everywhere, rendered as a link when it goes somewhere; href leaves the site
export function Action({
  variant = 'secondary',
  size = 'sm',
  to,
  href,
  onClick,
  disabled,
  className,
  children,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  to?: string
  href?: string
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const classes = cx(button(variant, size), className)
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    )
  }
  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  )
}

// a line of text that always takes its full height, empty or not, so slots line up across cards
export function TextSlot({ lines, className, children }: { lines: 1 | 2; className?: string; children: ReactNode }) {
  return (
    <p className={cx(lines === 1 ? 'h-5 truncate' : 'h-10 line-clamp-2', 'text-[13px] leading-5 text-newsprint-gray', className)}>
      {children}
    </p>
  )
}

// a clipped answer with the rest one click away; four whole lines fit every card, rated or not
export function ResultBox({
  label,
  preview,
  moreLabel,
  onMore,
  className,
}: {
  label: string
  preview: string
  moreLabel?: string
  onMore?: () => void
  className?: string
}) {
  return (
    <div className={cx('flex min-h-0 flex-col overflow-hidden rounded-[10px] bg-echo-green/30 p-3', className)}>
      <p className={LABEL}>{label}</p>
      <p className="mt-1.5 line-clamp-4 text-[13px] leading-5 text-press-black">{preview}</p>
      {onMore && moreLabel ? (
        <button
          type="button"
          onClick={onMore}
          className="micro mt-auto self-start pt-2 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-press-black"
        >
          {moreLabel}
        </button>
      ) : null}
    </div>
  )
}

// the five numbered boxes a rating is picked from and shown in; with onPick they are buttons
export function RatingBoxes({
  value,
  onPick,
  disabled,
  size = 'sm',
  label,
}: {
  value: number | null
  onPick?: (n: number) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  label: string
}) {
  const box = size === 'md' ? 'h-8 w-8 text-sm' : 'h-7 w-7 text-[12px]'
  const lit = 'border-highlighter-green/70 bg-highlighter-green/15 text-press-black'
  const dim = 'border-slate-verdant/40 text-newsprint-gray'
  return (
    <div className="flex gap-1" role={onPick ? 'radiogroup' : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value
        const classes = cx('grid place-items-center rounded-[5px] border hairline', box, on ? lit : dim)
        return onPick ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5`}
            onClick={() => onPick(n)}
            disabled={disabled}
            className={cx(classes, 'transition hover:border-press-black disabled:opacity-60')}
          >
            {n}
          </button>
        ) : (
          <span key={n} className={classes}>
            {n}
          </span>
        )
      })}
    </div>
  )
}

// a modal for whatever is longer than its slot; Escape and the close button both dismiss it
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(640px,92vw)] rounded-[14px] border hairline border-slate-verdant/40 bg-bone-white p-0 text-press-black backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between gap-4 border-b hairline border-slate-verdant/30 px-5 py-3">
        <p className={LABEL}>{title}</p>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="micro min-h-10 px-2 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-press-black"
        >
          Close
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto p-5">{children}</div>
    </dialog>
  )
}

export function FigureTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metal min-w-0 rounded-[14px] border hairline border-slate-verdant/40 p-5">
      <p className={LABEL}>{label}</p>
      <p className="mt-2 truncate font-serif text-[28px] leading-tight tabular-nums text-press-black" title={value}>
        {value}
      </p>
      <TextSlot lines={1} className="mt-1">
        {note ?? ''}
      </TextSlot>
    </div>
  )
}

// a day with nothing keeps a faint tick, so the days can still be counted
export function BarStrip({ days, label }: { days: { day: string; count: number }[]; label: string }) {
  const top = Math.max(1, ...days.map((d) => d.count))
  const step = 10
  const height = 32
  return (
    <svg
      viewBox={`0 0 ${days.length * step} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-8 w-full"
    >
      {days.map((d, i) => {
        const h = d.count === 0 ? 1 : Math.max(3, Math.round((d.count / top) * (height - 2)))
        return (
          <rect
            key={d.day}
            x={i * step + 1.5}
            y={height - h}
            width={step - 3}
            height={h}
            className={d.count === 0 ? 'fill-newsprint-gray/40' : 'fill-press-black'}
          >
            <title>{`${d.day}: ${d.count}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

export type CheckMark = { state: 'answered' | 'gated' | 'missed'; title: string }

// filled, toned or outlined, so the record reads without relying on colour alone
export function CheckStrip({ marks, label }: { marks: CheckMark[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex flex-wrap gap-[3px]">
      {marks.map((m, i) => (
        <span
          key={i}
          title={m.title}
          className={cx(
            'h-3 w-3 rounded-[3px]',
            m.state === 'answered' && 'bg-highlighter-green',
            m.state === 'gated' && 'bg-newsprint-gray/50',
            m.state === 'missed' && 'border hairline border-newsprint-gray',
          )}
        />
      ))}
    </div>
  )
}
