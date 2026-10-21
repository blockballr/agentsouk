import { useI18n } from '../lib/i18n'
import { cx } from './ui'

// the support door where a visitor stalls: the telegram the footer names, carried as a
// small question-mark button so it can sit beside the forms and failures themselves
export const SUPPORT_TELEGRAM = 'https://t.me/agentsouk'

export function SupportButton({
  className,
  plain,
  iconFirst,
}: {
  className?: string
  plain?: boolean
  iconFirst?: boolean
}) {
  const { t } = useI18n()
  const icon = (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
  return (
    <a
      href={SUPPORT_TELEGRAM}
      target="_blank"
      rel="noreferrer"
      className={cx(
        'micro inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] px-3 py-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data',
        // on the indigo band the peach is the dark-register value in both themes,
        // so it does not turn brown on the navy in light mode
        plain ? 'text-souk-peach hover:text-souk-ink' : 'bg-souk-indigo text-[#f2936b] hover:brightness-110',
        className,
      )}
    >
      {iconFirst ? icon : null}
      {t('ticker.support')}
      {iconFirst ? null : icon}
    </a>
  )
}
