import { Link } from 'react-router-dom'
import { Dot, Txt } from './souk'
import { explorerTxBase } from '../lib/contracts'
import { RAIL_LABEL, timeAgo, type FeedState } from '../lib/proof-feed'

// one row per confirmed action; the whole row opens the transaction
export function ProofFeedList({ feed, chainId, rows }: { feed: FeedState; chainId: number; rows: number }) {
  if (feed.items === null) {
    return (
      <Txt size={13} lead={20} tone="steel" className="block py-6">
        {feed.failed ? 'The feed could not be read just now.' : 'Reading the feed.'}
      </Txt>
    )
  }
  if (feed.items.length === 0) {
    return (
      <Txt size={13} lead={20} tone="steel" className="block py-6">
        Nothing confirmed on chain yet.
      </Txt>
    )
  }

  return (
    <div>
      <ul className="divide-y divide-souk-hair border-y border-souk-hair">
        {feed.items.slice(0, rows).map((item) => (
          <li key={item.txHash + item.kind}>
            <a
              href={`${explorerTxBase(chainId)}/tx/${item.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3.5 transition-colors hover:bg-souk-surface1 sm:grid-cols-[88px_minmax(0,1.2fr)_minmax(0,1.4fr)_auto_auto] sm:px-2"
            >
              <span className="hidden font-mono text-[11px] text-souk-labels sm:block">{timeAgo(item.at)}</span>
              <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 sm:col-start-auto sm:row-start-auto">
                <Dot tone={item.kind === 'trade' ? 'sky' : 'good'} size={7} />
                <Txt size={14} lead={20} weight="semibold" tone="ink" className="truncate">
                  {item.agentName}
                </Txt>
              </span>
              <span className="col-span-2 min-w-0 truncate text-[13px] leading-[20px] text-souk-slate sm:col-span-1">
                {item.detail}
                <span className="font-mono text-[11px] text-souk-labels sm:hidden"> {timeAgo(item.at)}</span>
              </span>
              <span className="hidden font-mono text-[13px] text-souk-ink sm:block">
                {item.amount ? `${item.amount} ${item.symbol ?? ''}`.trim() : ''}
              </span>
              <span
                title={RAIL_LABEL[item.rail]}
                className="col-start-2 row-start-1 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-data sm:col-start-auto sm:row-start-auto"
              >
                Transaction
              </span>
            </a>
          </li>
        ))}
      </ul>
      {feed.unavailable.length > 0 ? (
        <Txt size={11} lead={16} tone="steel" className="mt-2 block">
          Not shown just now: {feed.unavailable.join(', ')}.
        </Txt>
      ) : null}
    </div>
  )
}

export function ProofFeedLink() {
  return (
    <Link to="/proof" className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-sky transition hover:text-souk-ink">
      The whole feed
    </Link>
  )
}
