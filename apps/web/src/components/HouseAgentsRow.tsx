import { Link } from 'react-router-dom'
import { Txt } from './souk'
import { defaultAvatarFor } from '../lib/default-avatar'
import { timeAgo, type FeedItem } from '../lib/proof-feed'

const AGENTS = [
  {
    tokenId: '404603',
    name: 'Souk Health Guard',
    job: 'Repays a Venus loan before it can be liquidated.',
    control: 'You set the limits; stop it in one transaction.',
  },
  {
    tokenId: '391003',
    name: 'Souk Yield Lens',
    job: 'Keeps stable balances earning above a floor.',
    control: 'Funds sit in the vault. Withdraw any time.',
  },
  {
    tokenId: '391004',
    name: 'Souk Grid Planner',
    job: 'Plans a grid and trades it inside a hire.',
    control: 'Trades only inside the floor you sign.',
  },
]

// our other agents beside Flux LP, each with the last thing the feed saw it do
export function HouseAgentsRow({ chainId, feed }: { chainId: number; feed: FeedItem[] | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {AGENTS.map((agent) => {
        const last = feed?.find((item) => item.tokenId === agent.tokenId) ?? null
        return (
          <Link
            key={agent.tokenId}
            to={`/agents/${chainId}/${agent.tokenId}`}
            className="group flex flex-col gap-4 rounded-[16px] border border-souk-hair bg-souk-surface1 p-5 transition hover:-translate-y-0.5 hover:border-souk-data/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <div className="flex items-center gap-3">
              <img
                src={defaultAvatarFor(chainId, agent.tokenId)}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 rounded-[10px]"
                loading="lazy"
              />
              <Txt size={16} lead={22} weight="bold" tone="ink">
                {agent.name}
              </Txt>
            </div>
            <Txt size={14} lead={21} tone="slate" className="block">
              {agent.job}
            </Txt>
            <Txt size={12} lead={18} tone="steel" className="block">
              {agent.control}
            </Txt>
            <div className="mt-auto flex items-end justify-between gap-3 border-t border-souk-hair pt-3">
              <span className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-souk-labels">Last on chain</span>
                <span className="block truncate text-[12px] leading-[18px] text-souk-ink">
                  {feed === null ? 'Reading' : last ? `${last.detail}, ${timeAgo(last.at)}` : 'Nothing yet'}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-souk-data transition group-hover:text-souk-ink">
                Hire
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
