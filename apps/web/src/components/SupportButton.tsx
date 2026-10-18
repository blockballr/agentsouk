import { button, cx } from './ui'

// the support door where a visitor stalls: the telegram the footer names, carried as a
// small question-mark button so it can sit beside the forms and failures themselves
export const SUPPORT_TELEGRAM = 'https://t.me/agentsouk'

export function SupportButton({ className }: { className?: string }) {
  return (
    <a
      href={SUPPORT_TELEGRAM}
      target="_blank"
      rel="noreferrer"
      className={cx(button('secondary', 'sm'), className)}
    >
      <span
        aria-hidden="true"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none"
      >
        ?
      </span>
      Support
    </a>
  )
}
