import { ProofFeedList } from '../components/ProofFeedList'
import { SectionHead, Txt } from '../components/souk'
import { useProofFeed } from '../lib/proof-feed'
import { useTargetChain } from '../lib/target-chain'

// the whole feed: every confirmed action the market has recorded, newest first
export function ProofPage() {
  const chainId = useTargetChain()?.chainId ?? 56
  const feed = useProofFeed(50)
  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-11 lg:px-8">
      <SectionHead as="h2" title="Live from the chain." note="EVERY ROW IS A TRANSACTION" />
      <Txt size={14} lead={21} tone="slate" className="mt-4 block max-w-[60ch]">
        Paid hires and vault trades, newest first. A row appears only once its transaction is confirmed; each one opens
        on the block explorer.
      </Txt>
      <div className="mt-8">
        <ProofFeedList feed={feed} chainId={chainId} rows={50} />
      </div>
    </div>
  )
}
