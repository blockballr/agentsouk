import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, formatUnits, shortAddress, timeAgo } from '@agora/core'
import {
  getAgentsByOwner,
  getHiresByPayee,
  type OwnedAgent,
  type OwnedAgentsResult,
  type PayeeHire,
} from '../lib/api'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { hireErrorText } from '../lib/hire'
import { connectWallet, getActiveAccount } from '../lib/wallet'

type HiresSource = 'postgres' | 'memory' | null

const verificationTone: Record<string, string> = {
  delivered: 'border-highlighter-green/50 text-highlighter-green',
  gated: 'border-slate-verdant/40 text-slate-verdant',
  dead: 'border-press-black/30 text-press-black',
  unreachable: 'border-slate-verdant/45 text-newsprint-gray',
}

function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? (key === 'general' ? 'General' : key)
}

function verificationLabel(agent: OwnedAgent): string {
  const status = agent.verification?.status
  if (!status) return 'Not checked'
  if (status === 'delivered') return 'Endpoint answered'
  if (status === 'gated') return 'Endpoint gated'
  if (status === 'dead') return 'Endpoint did not answer'
  return 'Endpoint unreachable'
}

function endpointLabel(agent: OwnedAgent): string {
  const status = agent.verification?.status
  if (!status) return 'Not checked yet'
  if (status === 'delivered') return 'Answered'
  if (status === 'gated') return 'Answered, gated'
  if (status === 'dead') return 'Did not answer'
  return 'Unreachable'
}

function modeLabel(mode: PayeeHire['mode']): string {
  if (mode === 'prod') return 'on-chain settlement'
  if (mode === 'b402') return 'B402 settlement'
  return 'sandbox settlement'
}

// a stored amount is raw base units; format it only when the asset's decimals are known
function formatHireAmount(hire: PayeeHire): string {
  if (hire.decimals === null) return hire.amount
  try {
    return formatUnits(BigInt(hire.amount), hire.decimals)
  } catch {
    return hire.amount
  }
}

// a memory-mode store only knows what this instance recorded, so a total from it is a
// floor rather than the truth; a durable zero is a real zero
function receivedLabel(received: number, source: HiresSource): string {
  if (source === 'postgres') return String(received)
  if (source === 'memory') return received > 0 ? `${received} seen here` : 'Unavailable on this instance'
  return 'Unavailable'
}

export function ProfilePage() {
  const [account, setAccount] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [owned, setOwned] = useState<OwnedAgentsResult | null>(null)
  const [hires, setHires] = useState<PayeeHire[] | null>(null)
  const [hiresSource, setHiresSource] = useState<HiresSource>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiresError, setHiresError] = useState<string | null>(null)

  useEffect(() => {
    void getActiveAccount().then(setAccount)
  }, [])

  const load = useCallback(async () => {
    if (!account) {
      setOwned(null)
      setHires(null)
      setHiresSource(null)
      return
    }
    setLoading(true)
    setError(null)
    setHiresError(null)
    // the two reads are independent, so a receipts outage must not hide the listings
    const [ownedResult, hiresResult] = await Promise.allSettled([
      getAgentsByOwner(account),
      getHiresByPayee(account),
    ])
    if (ownedResult.status === 'fulfilled') {
      setOwned(ownedResult.value)
    } else {
      setError(hireErrorText(ownedResult.reason))
    }
    if (hiresResult.status === 'fulfilled') {
      setHires(hiresResult.value.hires)
      setHiresSource(hiresResult.value.source)
    } else {
      setHires(null)
      setHiresSource(null)
      setHiresError(hireErrorText(hiresResult.reason))
    }
    setLoading(false)
  }, [account])

  useEffect(() => {
    void load()
  }, [load])

  async function onConnect() {
    setConnecting(true)
    try {
      const addr = await connectWallet()
      setAccount(addr)
    } catch (e) {
      setError(hireErrorText(e))
    } finally {
      setConnecting(false)
    }
  }

  const agents = owned?.agents ?? []
  const receivedByToken = new Map<string, number>()
  for (const h of hires ?? []) {
    const key = `${h.chainId}:${h.tokenId}`
    receivedByToken.set(key, (receivedByToken.get(key) ?? 0) + 1)
  }
  const settledChain = hires?.[0]?.chainId ?? owned?.chainId ?? null

  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">Your profile</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-serif text-[clamp(40px,6vw,88px)] font-medium leading-[0.9] tracking-[-0.04em]">
          Your listings.
        </h1>
        {account && owned && (
          <div className="flex flex-wrap gap-6 text-[13px] text-newsprint-gray">
            <span>
              <strong className="text-press-black">{owned.counts.agents}</strong>{' '}
              {owned.counts.agents === 1 ? 'listing' : 'listings'}
            </span>
            {hiresSource === 'postgres' && hires && (
              <span>
                <strong className="text-press-black">{hires.length}</strong>{' '}
                {hires.length === 1 ? 'hire' : 'hires'} received
              </span>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        What you listed, whether the verifier reached it, and who hired it. Read
        from the registry and the verifier&apos;s own record for the wallet you
        connect. Registration is your own transaction; this is where you watch it
        land and get hired.
      </p>

      {!account && (
        <div className="mt-10 rounded-[14px] border hairline border-slate-verdant/40 p-10">
          <p className="text-[15px] text-typesetter-ink">
            Connect the wallet you listed with.
          </p>
          <p className="mt-2 text-[13px] text-newsprint-gray">
            A listing belongs to the wallet the registry records as owner.
            Without a connection we cannot tell which listings are yours.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="micro mt-6 rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 disabled:opacity-60"
          >
            {connecting ? 'Connecting...' : 'Connect wallet'}
          </button>
        </div>
      )}

      {account && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="micro text-newsprint-gray">
              Showing listings for{' '}
              <span className="font-mono text-press-black">{shortAddress(account)}</span>
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="micro rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
            >
              {loading ? 'Reading...' : 'Refresh'}
            </button>
          </div>

          {error && (
            <p className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
              {error}
            </p>
          )}

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {owned && agents.length === 0 && (
              <div className="rounded-[14px] border hairline border-slate-verdant/40 p-10 sm:col-span-2 xl:col-span-3">
                <p className="text-[15px] text-newsprint-gray">
                  This wallet owns no listed agents on this chain yet.
                </p>
                <p className="mt-2 text-[13px] text-newsprint-gray/80">
                  If you registered just now, the catalogue reads the chain again
                  within a minute, and the listing appears here once it has a
                  callable endpoint and a category the classifier assigns.
                </p>
                <Link
                  to="/list"
                  className="micro mt-6 inline-block rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95"
                >
                  List an agent
                </Link>
              </div>
            )}

            {agents.map((agent) => (
              <OwnedAgentCard
                key={`${agent.chainId}:${agent.tokenId}`}
                agent={agent}
                received={receivedByToken.get(`${agent.chainId}:${agent.tokenId}`) ?? 0}
                source={hiresSource}
              />
            ))}
          </div>

          <HiresPanel
            hires={hires}
            source={hiresSource}
            error={hiresError}
            chainId={settledChain}
          />

          <div className="mt-16 rounded-[14px] border hairline border-highlighter-green/50 bg-highlighter-green/5 p-8">
            <h2 className="font-serif text-2xl font-medium">List another agent</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-newsprint-gray">
              The wizard registers straight from your wallet with one
              transaction, and the registry records you as owner. A new listing
              shows up here once the catalogue reads the chain again.
            </p>
            <Link
              to="/list"
              className="micro mt-6 inline-block rounded-[5px] bg-highlighter-green px-5 py-3 text-typesetter-ink shadow transition hover:brightness-95"
            >
              Open the listing wizard
            </Link>
          </div>
        </>
      )}
    </section>
  )
}

function OwnedAgentCard({
  agent,
  received,
  source,
}: {
  agent: OwnedAgent
  received: number
  source: HiresSource
}) {
  const explorer = explorerTxBase(agent.chainId)
  const registryUrl = `${explorer}/token/${agent.contractAddress}?a=${agent.tokenId}`
  const verification = agent.verification

  return (
    <article className="rounded-[14px] border hairline border-slate-verdant/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to={`/agents/${agent.chainId}/${agent.tokenId}`}
            className="font-serif text-[22px] leading-tight text-press-black transition hover:text-highlighter-green"
          >
            {agent.name}
          </Link>
          <p className="micro mt-2 text-newsprint-gray">
            {categoryLabel(agent.category)} · token #{agent.tokenId}
            {!agent.isActive ? ' · inactive' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`micro rounded-full border hairline px-2.5 py-1 ${
              verification ? verificationTone[verification.status] : 'border-slate-verdant/45 text-newsprint-gray'
            }`}
          >
            {verificationLabel(agent)}
          </span>
          {agent.x402Supported ? (
            <span className="micro rounded-full border hairline border-highlighter-green/40 px-2.5 py-1 text-highlighter-green">
              x402
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid gap-3 text-[13px] text-newsprint-gray">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="micro shrink-0">Last checked</dt>
          <dd className="text-right text-press-black">
            {verification ? timeAgo(verification.checkedAt) : 'Not checked yet'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="micro shrink-0">Endpoint</dt>
          <dd className="text-right text-press-black">{endpointLabel(agent)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="micro shrink-0">Hires received</dt>
          <dd className="text-right text-press-black">{receivedLabel(received, source)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="micro shrink-0">Grade</dt>
          <dd className="text-right text-press-black">
            {verification?.quality ? `${verification.quality.grade} · ${verification.quality.reason}` : 'n/a'}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to={`/agents/${agent.chainId}/${agent.tokenId}`}
          className="micro rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black"
        >
          Open agent page
        </Link>
        <a
          href={registryUrl}
          target="_blank"
          rel="noreferrer"
          className="micro rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black"
        >
          Registry record
        </a>
        <span className="font-mono text-[11px] text-newsprint-gray">
          {shortAddress(agent.contractAddress, 8)}
        </span>
      </div>
    </article>
  )
}

function HiresPanel({
  hires,
  source,
  error,
  chainId,
}: {
  hires: PayeeHire[] | null
  source: HiresSource
  error: string | null
  chainId: number | null
}) {
  const network = chainId ? chainLabel(chainId) : null
  return (
    <div className="mt-16">
      <p className="micro text-newsprint-gray">Hires received</p>
      <h2 className="mt-4 font-serif text-[32px] font-medium tracking-[-0.02em]">
        Who hired your agents.
      </h2>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-newsprint-gray">
        Payments settled to the wallet you connect
        {network ? ` on ${network}` : ''}, which is the receiving wallet a hire
        pays unless the listing names a separate agent wallet. A hire records a
        payer and a payee, and this reads the payee side, so it answers
        &quot;did anyone hire me&quot; rather than &quot;what did I hire&quot;.
      </p>

      {error && (
        <p className="mt-6 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs text-press-black">
          {error}
        </p>
      )}

      {source === 'memory' && (
        <p className="mt-6 rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 text-xs leading-relaxed text-newsprint-gray">
          This server instance keeps receipts in memory only, so it cannot state
          a reliable total. Only payments it recorded itself are listed below;
          the true figure may be higher.
        </p>
      )}

      {source === 'postgres' && hires && hires.length === 0 && (
        <p className="mt-6 text-[15px] text-newsprint-gray">
          No hires recorded yet. When a buyer settles a session to one of your
          agents, the payment appears here.
        </p>
      )}

      {source === 'memory' && hires && hires.length === 0 && (
        <p className="mt-6 text-[15px] text-newsprint-gray">
          Nothing recorded on this instance, which is not proof that nobody
          hired you.
        </p>
      )}

      {hires && hires.length > 0 && (
        <div className="mt-6 space-y-3">
          {hires.map((hire) => (
            <HireRow key={hire.paymentId} hire={hire} />
          ))}
        </div>
      )}
    </div>
  )
}

function HireRow({ hire }: { hire: PayeeHire }) {
  const explorer = explorerTxBase(hire.chainId)
  // a sandbox hash is derived from the payment id, so only a real relayed
  // settlement links to a block explorer
  const canLinkTx = hire.mode === 'prod' && Boolean(hire.txHash)
  return (
    <article className="rounded-[10px] border hairline border-slate-verdant/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/agents/${hire.chainId}/${hire.tokenId}`}
            className="font-serif text-[20px] leading-none text-press-black transition hover:text-highlighter-green"
          >
            {hire.agentName}
          </Link>
          <p className="mt-2 text-[13px] text-newsprint-gray">
            paid by{' '}
            <span className="font-mono text-press-black">{shortAddress(hire.client)}</span>{' '}
            · {formatHireAmount(hire)}{' '}
            <span className="text-press-black">{hire.symbol}</span>{' '}
            · {modeLabel(hire.mode)} · {timeAgo(hire.createdAt)}
          </p>
        </div>
        <span
          className={`micro rounded-full border hairline px-2.5 py-1 ${
            hire.active
              ? 'border-highlighter-green/50 text-highlighter-green'
              : 'border-slate-verdant/45 text-newsprint-gray'
          }`}
        >
          {hire.active ? 'active session' : 'ended'}
        </span>
      </div>
      {canLinkTx && hire.txHash && (
        <a
          href={`${explorer}/tx/${hire.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="micro mt-3 inline-block text-newsprint-gray underline transition hover:text-press-black"
        >
          Settlement transaction
        </a>
      )}
    </article>
  )
}
