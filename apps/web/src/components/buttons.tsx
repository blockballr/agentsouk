import type { ButtonHTMLAttributes, ReactNode } from 'react'

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type CommonProps = {
  children: ReactNode
  className?: string
}

// the only filled, saturated button on the site
// green fill, ink label, sharp 5px radius, green-tinted elevation
export function PrimaryButton({
  children,
  className,
  type = 'button',
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        'group micro inline-flex items-center gap-2.5 rounded-[5px] bg-highlighter-green px-[30px] py-5 text-typesetter-ink shadow-lg motion-safe:transition-[transform,filter,box-shadow] motion-safe:duration-150 hover:scale-[1.03] hover:brightness-95 hover:shadow-[rgba(16,94,29,0.55)_1px_10px_26px_0px] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black',
        className,
      )}
      {...rest}
    >
      {children}
      <Arrow />
    </button>
  )
}

// secondary action on dark sections
// tall vertical padding makes these read as full-height menu items
export function GhostButton({
  children,
  className,
  size = 'tall',
  type = 'button',
  ...rest
}: CommonProps & { size?: 'tall' | 'compact' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cx(
        'micro inline-flex items-center gap-2.5 rounded-[10px] border border-bone-white text-bone-white motion-safe:transition-[transform,background-color,border-color] motion-safe:duration-150 hover:scale-[1.02] hover:bg-bone-white/10 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white',
        size === 'tall' ? 'px-5 py-[50px]' : 'px-5 py-3',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

function Arrow() {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 14 10"
      fill="none"
      aria-hidden="true"
      className="translate-x-0 motion-safe:transition-transform motion-safe:duration-150 group-hover:translate-x-1"
    >
      <path
        d="M0 5h12M8 1l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}