// The hire rails for any agent. The page supplies the rails the marketplace can
// actually run; this component only names them, shows who owns the guarantee,
// and hands the chosen kind back. Nothing here knows a token id, a name or a host.
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
  return (
    <Stack gap={10} className={className}>
      {rails.map((rail) => (
        <div
          key={rail.kind}
          className="rounded-[12px] border border-souk-hair bg-souk-surface2/45 p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Txt size={15} lead={20} weight="bold" tone="ink">
              {rail.title}
            </Txt>
            <RailBadge source={rail.source} />
          </div>
          <Txt size={12} lead={18} tone="slate" className="mt-1 block">
            {rail.body}
          </Txt>
          <button
            type="button"
            onClick={() => onChoose(rail.kind)}
            className={cx(button('primary', 'sm'), 'mt-3 w-full')}
          >
            {viewer ? 'Start' : 'Connect to start'}
          </button>
        </div>
      ))}
      {rails.length === 0 ? (
        <Txt size={13} lead={20} tone="slate">
          No bookable action here. This listing has not published a rail the marketplace can run.
        </Txt>
      ) : null}
    </Stack>
  )
}
