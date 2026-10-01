import { useRef } from 'react'
import type { StepKey } from '../lib/quest'
import { QuestStamp } from './QuestStamp'
import { Action, LABEL, card, cx } from './ui'

// the quest's guide on a real page: it names the one thing to do now, and nothing is blocked
export function QuestStrip({
  label,
  text,
  done,
  stamp,
  textId,
  className,
}: {
  label: string
  text: string
  done?: boolean
  // the stamp this step leaves: an outline while the step is open, inked once it is done
  stamp?: StepKey
  // lets the control the strip talks about point at this text
  textId?: string
  className?: string
}) {
  // a step already finished when the page opened shows its stamp without the press
  const began = useRef(Boolean(done))
  return (
    <div role="note" className={cx(card('strong', 'sm'), 'flow-root', className)}>
      {/* floated into the corner, so the words wrap round it at any width */}
      {stamp ? (
        <QuestStamp step={stamp} stamped={Boolean(done)} press={!began.current} className="float-right -mr-2 -mt-2 ml-3 w-[104px] sm:w-[120px]" />
      ) : null}
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
