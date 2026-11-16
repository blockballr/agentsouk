// The hire rails for any agent. The page supplies the rails the marketplace can
// actually run; this component only names them, shows who owns the guarantee,
// and hands the chosen kind back. Nothing here knows a token id, a name or a host.
import { useState } from 'react'
import { railSourceLabel, type AgentRail, type RailKind, type RailSource } from '../lib/agent-rails'
import { Pill, Stack, Txt, type PillVariant } from './souk'
import { button, cx } from './ui'

const SOURCE_VARIANT: Record<RailSource, PillVariant> = {
  'agent-souk': 'good',
  verified: 'keep',
  agent: 'off',
}

export function RailBadge({ source }: { source: RailSource }) {
  return <Pill variant={SOURCE_VARIANT[source]}>{railSourceLabel(source)}</Pill>
}

// the tab names say how the buyer pays, not which protocol carries it
const TAB_LABEL: Record<RailKind, string> = {
  vault: 'Vault',
  job: 'Pay on delivery',
  call: 'Pay per answer',
}

export function RailChooser({
  rails,
  viewer,
  onChoose,
  className,
}: {
  rails: AgentRail[]
  viewer: string | null
  onChoose: (kind: RailKind) => void
  className?: string
}) {
  const [picked, setPicked] = useState<RailKind | null>(null)
  if (rails.length === 0) {
    return (
      <Txt size={13} lead={20} tone="slate" className={className}>
        No bookable action here. This listing has not published a rail the marketplace can run.
      </Txt>
    )
  }
  const rail = rails.find((r) => r.kind === picked) ?? rails[0]
  return (
    <Stack gap={12} className={className}>
      {rails.length > 1 ? (
        <div role="tablist" aria-label="How to pay" className="flex gap-1 rounded-[10px] border border-souk-hair p-1">
          {rails.map((r) => (
            <button
              key={r.kind}
              type="button"
              role="tab"
              aria-selected={r.kind === rail.kind}
              onClick={() => setPicked(r.kind)}
              className={cx(
                'flex-1 rounded-[7px] px-2 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data',
                r.kind === rail.kind ? 'bg-souk-surface2 text-souk-ink' : 'text-souk-steel hover:text-souk-ink',
              )}
            >
              {TAB_LABEL[r.kind]}
            </button>
          ))}
        </div>
      ) : null}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Txt size={15} lead={20} weight="bold" tone="ink">
            {rail.title}
          </Txt>
          <RailBadge source={rail.source} />
        </div>
        <Txt size={12} lead={18} tone="slate" className="mt-1 block">
          {rail.body}
        </Txt>
      </div>
      <button type="button" onClick={() => onChoose(rail.kind)} className={cx(button('primary', 'sm'), 'w-full')}>
        {viewer ? 'Start' : 'Connect to start'}
      </button>
    </Stack>
  )
}
