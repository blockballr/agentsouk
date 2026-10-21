// One read for the three seller boards. Board A (the morning view), Board B
// (the stalls) and Board C (the market face) all describe the same listings and
// the same receipts, so the console loads them once and each board reads its
// slice instead of firing the same requests again.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  getAgents,
  getAgentsByOwner,
  getHiresByPayee,
  getJobs8183Jobs,
  getListingViews,
  getNotifications,
  type Jobs8183Row,
  type NotificationRow,
  type OwnedAgentsResult,
  type PayeeHire,
} from './api'
import { hireErrorText } from './hire'

export type HiresSource = 'postgres' | 'memory' | null
export type Catalogue = Awaited<ReturnType<typeof getAgents>>

export interface SellerDataValue {
  account: string | null
  owned: OwnedAgentsResult | null
  hires: PayeeHire[] | null
  hiresSource: HiresSource
  catalogue: Catalogue | null
  views: number | null
  jobs: Jobs8183Row[] | null
  notifications: NotificationRow[] | null
  loading: boolean
  ready: boolean
  /** both listings and receipts failed: the board cannot state either */
  error: string | null
  /** the listings read failed on its own */
  ownedError: string | null
  /** the receipts read failed on its own */
  hiresError: string | null
  /** the notifications read failed on its own */
  feedError: boolean
  reload: () => Promise<void>
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ZERO_ADDRESS = /^0x0{40}$/i

// A builder listing settles to its own agent wallet, not necessarily the wallet
// that owns the token. Collect every distinct payee the owner's listings name so
// the board can read each one; the owner wallet is already read separately.
function extraPayees(owner: string, owned: OwnedAgentsResult | null): string[] {
  const seen = new Set<string>([owner.toLowerCase()])
  const payees: string[] = []
  for (const agent of owned?.agents ?? []) {
    const wallet = agent.agentWallet?.trim() ?? ''
    if (!ADDRESS.test(wallet) || ZERO_ADDRESS.test(wallet)) continue
    const key = wallet.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    payees.push(wallet)
  }
  return payees
}

// One settlement can be read from more than one payee only if the same payment
// id is returned twice; keying by payment id keeps the chart from double-counting.
function mergeHires(groups: readonly PayeeHire[][]): PayeeHire[] {
  const byPayment = new Map<string, PayeeHire>()
  for (const group of groups) {
    for (const hire of group) byPayment.set(hire.paymentId, hire)
  }
  return [...byPayment.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

const SellerDataContext = createContext<SellerDataValue | null>(null)

export function SellerDataProvider({ account, children }: { account: string | null; children: ReactNode }) {
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [views, setViews] = useState<number | null>(null)
  const [jobs, setJobs] = useState<Jobs8183Row[] | null>(null)
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownedError, setOwnedError] = useState<string | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)
  const [feedError, setFeedError] = useState(false)
  // a wallet switch starts a new read; an older one must not land on top of it
  const seq = useRef(0)

  const reload = useCallback(async (): Promise<void> => {
    const run = ++seq.current
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      setCatalogue(null)
      setViews(null)
      setJobs(null)
      setNotifications(null)
      setLoading(false)
      setReady(false)
      setError(null)
      setOwnedError(null)
      setHiresError(null)
      setFeedError(false)
      return
    }
    setLoading(true)
    setError(null)
    setOwnedError(null)
    setHiresError(null)
    setFeedError(false)
    // independent reads, so a receipts outage never hides the listings and a
    // catalogue outage never hides the money
    const [ownedResult, ownerHiresResult, jobsResult, feedResult, catResult] =
      await Promise.allSettled([
        getAgentsByOwner(account),
        getHiresByPayee(account),
        getJobs8183Jobs(account),
        getNotifications(account),
        getAgents({ limit: 1 }),
      ])
    const owned = ownedResult.status === 'fulfilled' ? ownedResult.value : null
    const payees = extraPayees(account, owned)
    // the views count and the extra payee reads both need the listing read, so
    // they start together rather than one waiting on the other
    const viewsRead = (async (): Promise<number | null> => {
      if (!owned) return null
      const chainId = owned.chainId
      const tokens = owned.agents.map((a) => String(a.tokenId))
      if (chainId === null || tokens.length === 0) return chainId === null ? null : 0
      const counts = await getListingViews(chainId, tokens, 14).catch(() => null)
      return counts === null ? null : Object.values(counts).reduce((sum, n) => sum + n, 0)
    })()
    const [viewCount, extraReads] = await Promise.all([
      viewsRead,
      Promise.allSettled(payees.map((payee) => getHiresByPayee(payee))),
    ])
    const ownerHires =
      ownerHiresResult.status === 'fulfilled' ? ownerHiresResult.value : null
    const groups: PayeeHire[][] = ownerHires ? [ownerHires.hires] : []
    const readErrors: string[] =
      ownerHiresResult.status === 'rejected'
        ? [hireErrorText(ownerHiresResult.reason)]
        : []
    let source: HiresSource = ownerHires?.source ?? null
    for (const result of extraReads) {
      if (result.status === 'fulfilled') {
        groups.push(result.value.hires)
        if (result.value.source === 'postgres') source = 'postgres'
        else if (source === null) source = result.value.source
      } else {
        readErrors.push(hireErrorText(result.reason))
      }
    }
    const merged = groups.length > 0 ? mergeHires(groups) : null
    // a failed owner read means the total is unknown; showing an empty chart
    // would claim zero. Partial payee data is still shown, with the error named.
    const hiresRead =
      ownerHiresResult.status === 'rejected' && (merged?.length ?? 0) === 0 ? null : merged
    if (run !== seq.current) return
    setOwned(owned)
    setViews(viewCount)
    setCatalogue(catResult.status === 'fulfilled' ? catResult.value : null)
    setHires(hiresRead)
    setHiresSource(hiresRead === null ? null : source)
    // escrow rows and notifications are readings, not commitments: a failed read
    // leaves its column honest rather than blanking the rest of the board
    setJobs(jobsResult.status === 'fulfilled' ? jobsResult.value : null)
    setNotifications(feedResult.status === 'fulfilled' ? feedResult.value.rows : null)
    setOwnedError(ownedResult.status === 'rejected' ? hireErrorText(ownedResult.reason) : null)
    setHiresError(readErrors.length > 0 ? [...new Set(readErrors)].join(' ') : null)
    setError(
      ownedResult.status === 'rejected' && ownerHiresResult.status === 'rejected'
        ? hireErrorText(ownedResult.reason)
        : null,
    )
    setFeedError(feedResult.status === 'rejected')
    setLoading(false)
    setReady(true)
  }, [account])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<SellerDataValue>(
    () => ({
      account,
      owned,
      hires,
      hiresSource,
      catalogue,
      views,
      jobs,
      notifications,
      loading,
      ready,
      error,
      ownedError,
      hiresError,
      feedError,
      reload,
    }),
    [
      account,
      owned,
      hires,
      hiresSource,
      catalogue,
      views,
      jobs,
      notifications,
      loading,
      ready,
      error,
      ownedError,
      hiresError,
      feedError,
      reload,
    ],
  )

  return <SellerDataContext.Provider value={value}>{children}</SellerDataContext.Provider>
}

export function useSellerData(): SellerDataValue {
  const value = useContext(SellerDataContext)
  if (!value) throw new Error('useSellerData must be used inside SellerDataProvider')
  return value
}
