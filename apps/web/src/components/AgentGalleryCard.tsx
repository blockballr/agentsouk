// The Agent Gallery card: the house agents we build and run, shown on the
// landing and at the top of the shelf. The marketplace stays the hiring
// surface; this card is the shortcut to the product showcase.
import { Dot, Txt } from './souk'
import { defaultAvatarFor } from '../lib/default-avatar'

const HOUSE_AGENTS = [
  {
    name: 'Flux LP',
    category: 'Rebalancing and LP ranges',
    tagline: 'LP agent for tokenized stocks on PancakeSwap V3 and Uniswap V3.',
    mark: 'https://fluxlp.agentsouk.xyz/brand/mark.svg',
    action: 'Open',
  },
  {
    name: 'Souk Yield Lens',
    category: 'Yield',
    tagline: "Keeps a stable balance working above the hire's liquid floor, on chain.",
    mark: defaultAvatarFor(56, '391003'),
    action: 'Hire',
  },
  {
    name: 'Souk Grid Planner',
    category: 'Grid trading',
    tagline: 'Plans a grid ladder and trades it inside a funded hire.',
    mark: defaultAvatarFor(56, '391004'),
    action: 'Hire',
  },
  {
    name: 'Souk Health Guard',
    category: 'Health factor',
    tagline: 'Defends a lending position when its health factor reaches the band.',
    mark: defaultAvatarFor(56, '404603'),
    action: 'Hire',
  },
]

export function AgentGalleryCard({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://agents.agentsouk.xyz"
      className={`block rounded-[16px] border border-souk-hair souk-glass p-5 transition-colors hover:border-souk-data/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-souk-data md:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Txt size={10} lead={14} mono upper tone="muted" className="block">
            Agent Gallery
          </Txt>
          <Txt size={18} lead={24} weight="bold" tone="ink" className="mt-1 block">
            The agents we build and run.
          </Txt>
        </div>
        <Txt size={13} lead={20} weight="semibold" tone="ink" className="inline-flex shrink-0 items-center gap-2">
          Open the gallery <span aria-hidden="true">&#8594;</span>
        </Txt>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {HOUSE_AGENTS.map((agent) => (
          <div
            key={agent.name}
            className="flex min-w-0 flex-col rounded-[12px] border border-souk-hair bg-souk-surface2/55 p-4 backdrop-blur-md"
          >
            <div className="flex min-w-0 items-start gap-3">
              <img
                src={agent.mark}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                className="h-10 w-10 shrink-0 rounded-[12px]"
              />
              <div className="min-w-0">
                <Txt size={9} lead={12} mono upper tone="muted" className="block">
                  {agent.category}
                </Txt>
                <Txt size={15} lead={20} weight="bold" tone="ink" className="mt-1 block">
                  {agent.name}
                </Txt>
              </div>
            </div>
            <Txt size={12} lead={18} tone="slate" className="mt-3 line-clamp-2">
              {agent.tagline}
            </Txt>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Dot tone="good" size={7} />
                <Txt size={9} lead={12} mono upper tone="steel">
                  live
                </Txt>
              </span>
              <Txt size={10} lead={14} mono upper tone="steel">
                {agent.action} <span aria-hidden="true">&#8594;</span>
              </Txt>
            </div>
          </div>
        ))}
      </div>
    </a>
  )
}
