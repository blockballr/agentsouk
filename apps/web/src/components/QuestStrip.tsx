import { Action, LABEL, card, cx } from './ui'

// the quest's guide on a real page: it names the one thing to do now, and nothing is blocked
export function QuestStrip({
  label,
  text,
  done,
  textId,
  className,
}: {
  label: string
  text: string
  done?: boolean
  // lets the control the strip talks about point at this text
  textId?: string
  className?: string
}) {
  return (
    <div role="note" className={cx(card('strong', 'sm'), className)}>
      <p className={LABEL}>Souk passport · {label}</p>
      <p id={textId} className="mt-2 text-[13px] leading-5 text-press-black">
        {text}
      </p>
      {done ? (
        <Action to="/quest" className="mt-3">
          Back to your passport
        </Action>
      ) : (
        <Action variant="quiet" to="/quest" className="mt-1">
          Back to your passport
        </Action>
      )}
    </div>
  )
}
