import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { AgentDetail, PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'
import {
  formatDate,
  formatNumber,
  formatScore,
  shortAddress,
  timeAgo,
} from '@agora/core'
import { activateBoost, deliverTask, getAgentDetail, getBoostStatus, getTask, retryTask, type DeliverData, type DeliverTool, type HireTask } from '../lib/api'
import {
  changeWallet,
  connectWallet,
  disconnectWallet,
  ensureBscChain,
  getActiveAccount,
  getProvider,
  setTargetChain,
} from '../lib/wallet'
import {
  fetchHireRequirements,
  hireErrorText,
  signAndSettleHire,
  type HireRequirementsData,
} from '../lib/hire'

const verificationTone: Record<string, string> = {
  delivered: 'border-highlighter-green/50 text-highlighter-green',
  gated: 'border-slate-verdant/40 text-slate-verdant',
  dead: 'border-slate-verdant/45 text-newsprint-gray',
  unreachable: 'border-slate-verdant/45 text-newsprint-gray',
}

function verificationLabel(status: string): string {
  return status === 'delivered' ? 'verified delivered' : status
}

function explorerBase(chainId: string): string {
  return chainId === '97' ? 'https://testnet.bscscan.com' : 'https://bscscan.com'
}

const scoreBars: { label: string; key: keyof AgentDetail }[] = [
  { label: 'Quality', key: 'quality_score' },
  { label: 'Popularity', key: 'popularity_score' },
  { label: 'Activity', key: 'activity_score' },
  { label: 'Wallet', key: 'wallet_score' },
  { label: 'Freshness', key: 'freshness_score' },
  { label: 'Metadata', key: 'metadata_completeness_score' },
]

interface ActiveSession {
  spendCapUsd: number
  expiresAt: string
  mode: 'sandbox' | 'prod' | 'b402'
  createdAt: string
}

export interface PerformanceProbe {
  tokenId: string
  status: string
  tool?: string
  rawOutput?: string
}

// self-reported performance comes from the committed scan output, served by the
// API as-is; a failed fetch just hides the section
async function fetchPerformanceProbe(
  tokenId: string,
): Promise<PerformanceProbe | null> {
  try {
    const base = import.meta.env.VITE_API_URL ?? '/api'
    const res = await fetch(`${base}/performance`)
    if (!res.ok) return null
    const body: { success?: boolean; data?: { probeResults?: PerformanceProbe[] } } =
      await res.json()
    if (!body.success || !body.data?.probeResults) return null
    const probe = body.data.probeResults.find(
      (p) => p.tokenId === tokenId && p.status === 'probed' && p.rawOutput,
    )
    return probe ?? null
  } catch {
    return null
  }
}

type DetailWithSession = AgentDetail & { activeSession?: ActiveSession }

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}

function sessionModeLabel(mode: ActiveSession['mode']): string {
  if (mode === 'b402') return 'BNB Chain (x402)'
  if (mode === 'sandbox') return 'Sandbox facilitator'
  return 'Production'
}

export function AgentDetailPage() {
  const { chainId = '56', tokenId = '' } = useParams()
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [perfProbe, setPerfProbe] = useState<PerformanceProbe | null>(null)

  useEffect(() => {
    let cancelled = false
    setPerfProbe(null)
    fetchPerformanceProbe(tokenId).then((p) => {
      if (!cancelled && p) setPerfProbe(p)
    })
    return () => {
      cancelled = true
    }
  }, [tokenId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getAgentDetail(chainId, tokenId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chainId, tokenId])

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-16" role="status" aria-label="Loading agent">
        <div className="animate-pulse space-y-4">
          <div className="h-3 w-24 bg-slate-verdant/10" />
          <div className="h-10 w-72 bg-slate-verdant/10" />
          <div className="h-4 w-1/2 bg-slate-verdant/10" />
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-24 text-center">
        <p className="font-serif text-[28px] font-medium">Agent not found.</p>
        <p className="mt-3 text-sm text-newsprint-gray">
          It may have left the registry, or the chain lookup failed.
        </p>
        <Link
          to="/agents"
          className="micro mt-8 inline-block rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Back to market
        </Link>
      </div>
    )
  }

  const onchain = detail.raw_metadata?.onchain ?? []
  const explorer = explorerBase(chainId)
  const bscScan = `${explorer}/token/${detail.contract_address}?a=${detail.token_id}`
  const ownerScan = `${explorer}/address/${detail.owner_address}`
  const activeSession = (detail as DetailWithSession).activeSession

  function refreshDetail() {
    getAgentDetail(chainId, tokenId)
      .then((d) => {
        if (d) setDetail(d)
      })
      .catch(() => {})
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <Link
        to="/agents"
        className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        ← Marketplace
      </Link>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="flex flex-col gap-6 rounded-[14px] border hairline border-slate-verdant/40 p-8 sm:flex-row sm:items-start">
            <img
              src={detail.image_url ?? '/inserts/arc.svg'}
              alt={detail.name}
              className="duotone h-24 w-24 shrink-0 rounded-[14px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-[clamp(32px,5vw,56px)] font-medium leading-[0.95] tracking-[-0.03em]">
                  {detail.name}
                </h1>
                {detail.is_verified && (
                  <span className="micro rounded-full border hairline border-highlighter-green/50 px-2.5 py-1 text-highlighter-green">
                    Verified
                  </span>
                )}
                {detail.is_endpoint_verified && (
                  <span className="micro rounded-full border hairline border-slate-verdant/40 px-2.5 py-1 text-slate-verdant">
                    Endpoint verified
                  </span>
                )}
                {detail.x402_supported && (
                  <span className="micro rounded-full bg-highlighter-green px-2.5 py-1 text-typesetter-ink">
                    Accepts x402
                  </span>
                )}
                {(detail as { boosted?: boolean }).boosted && (
                  <span
                    title="Paid boost: sorted higher on the marketplace"
                    className="micro rounded-full border hairline border-highlighter-green/60 bg-highlighter-green/10 px-2.5 py-1 text-highlighter-green"
                  >
                    Boosted
                  </span>
                )}
                {detail.verification && (
                  <span
                    title={
                      detail.verification.quality
                        ? `AI review: ${detail.verification.quality.grade} - ${detail.verification.quality.reason} (checked ${detail.verification.checkedAt.slice(0, 10)})`
                        : `Shopper checked ${detail.verification.checkedAt}`
                    }
                    className={`micro rounded-full border hairline px-2.5 py-1 ${verificationTone[detail.verification.status] ?? verificationTone.dead}`}
                  >
                    {verificationLabel(detail.verification.status)} · {detail.verification.checkedAt.slice(0, 10)}
                  </span>
                )}
                {detail.verification?.status === 'delivered' && detail.verification.concurrency === 'parallel-ok' && (
                  <span
                    title="verified: two simultaneous calls both delivered"
                    className="micro rounded-full border hairline border-highlighter-green/50 px-2.5 py-1 text-highlighter-green"
                  >
                    handles concurrent requests
                  </span>
                )}
              </div>
              <p className="mt-4 text-[18px] leading-snug text-newsprint-gray">
                {detail.description || 'No description registered on-chain.'}
              </p>
              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
                <span>
                  Owner{' '}
                  <a href={ownerScan} target="_blank" rel="noreferrer" className="font-mono text-press-black hover:text-highlighter-green">
                    {shortAddress(detail.owner_address)}
                  </a>
                </span>
                <span>Registered {formatDate(detail.created_at)}</span>
                <span>
                  Agent{' '}
                  <a href={bscScan} target="_blank" rel="noreferrer" className="font-mono text-press-black hover:text-highlighter-green">
                    #{detail.token_id}
                  </a>
                </span>
                <span>Updated {timeAgo(detail.updated_at)}</span>
              </div>
              {detail.pcs && (
                <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
                  <span className="text-press-black">PancakeSwap-native:</span>{' '}
                  this agent&apos;s own registration describes PancakeSwap V3
                  liquidity work.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
              <h2 className="micro text-newsprint-gray">Reputation</h2>
              <div className="mt-6 grid grid-cols-3 gap-6">
                <BigMetric label="Total score" value={formatScore(detail.total_score)} accent />
                <BigMetric label="Avg feedback" value={formatScore(detail.average_score)} />
                <BigMetric label="Hires" value={formatNumber(detail.total_feedbacks)} />
              </div>
              <div className="mt-8 space-y-5">
                {scoreBars.map((b) => (
                  <ScoreBar
                    key={b.label}
                    label={b.label}
                    value={Number(detail[b.key]) || 0}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
                <h2 className="micro text-newsprint-gray">Health &amp; activity</h2>
                <div className="mt-6 grid grid-cols-2 gap-6">
                  <BigMetric label="Health score" value={detail.health_score !== null ? formatScore(detail.health_score) : 'n/a'} />
                  <BigMetric label="Status" value={detail.health_status ?? (detail.is_active ? 'active' : 'inactive')} />
                </div>
              </div>

              <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
                <h2 className="micro text-newsprint-gray">Endpoints</h2>
                <div className="mt-6 space-y-3">
                  <Endpoint label="A2A" value={detail.a2a_endpoint} />
                  <Endpoint label="MCP" value={detail.mcp_server} />
                  <Endpoint label="Agent URL" value={detail.agent_url} />
                  <Endpoint label="Verified domain" value={detail.endpoint_verified_domain} />
                </div>
              </div>
            </div>
          </div>

          {perfProbe && <PerformanceSection probe={perfProbe} />}

          <PnlComingSoon name={detail.name} />

          {onchain.length > 0 && (
            <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
              <h2 className="micro text-newsprint-gray">On-chain metadata</h2>
              <dl className="mt-6 grid grid-cols-1 bg-bone-white pl-px pt-px sm:grid-cols-2">
                {onchain.map((m) => (
                  <div key={m.key} className="-ml-px -mt-px border hairline border-slate-verdant/40 bg-bone-white p-4">
                    <dt className="micro text-newsprint-gray">{m.key}</dt>
                    <dd className="mt-2 break-words font-mono text-xs leading-relaxed text-press-black">
                      {typeof m.value === 'string' ? m.value : JSON.stringify(m.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <aside className="h-fit rounded-[14px] border hairline border-slate-verdant/40 p-8 lg:sticky lg:top-8">
          {activeSession && (
            <div className="score-strip mb-6 rounded-[10px] p-4" role="status">
              <p className="micro text-press-black">Session active</p>
              <div className="mt-3 space-y-2 text-xs">
                <Row label="Spend cap" value={`$${activeSession.spendCapUsd}`} />
                <Row label="Expires" value={formatExpiry(activeSession.expiresAt)} />
                <Row label="Mode" value={sessionModeLabel(activeSession.mode)} />
              </div>
            </div>
          )}
          <h2 className="micro text-newsprint-gray">Hire this agent</h2>
          <div className="mt-6 space-y-4 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
            <div className="flex justify-between">
              <span>Model</span>
              <span className="text-press-black">Pay per request</span>
            </div>
            <div className="flex justify-between">
              <span>Session</span>
              <span className="text-press-black">24h · $10 cap</span>
            </div>
            <div className="flex justify-between">
              <span>Network</span>
              <span className="text-press-black">BNB</span>
            </div>
          </div>
          <HirePanel chainId={chainId} tokenId={detail.token_id} name={detail.name} onHired={refreshDetail} />
          <p className="mt-4 text-xs leading-relaxed text-newsprint-gray">
            You sign a gasless transfer authorization; a facilitator verifies and
            settles it on-chain. Funds go straight to the agent&apos;s wallet.
          </p>
          <BoostPanel
            chainId={chainId}
            tokenId={detail.token_id}
            name={detail.name}
            ownerAddress={detail.owner_address}
            agentWallet={detail.agent_wallet}
            alreadyBoosted={Boolean((detail as { boosted?: boolean }).boosted)}
            onBoosted={refreshDetail}
          />
        </aside>
      </div>
    </div>
  )
}

type HireStep = 'idle' | 'connecting' | 'preview' | 'signing' | 'settling' | 'hired'

function BoostPanel({
  chainId,
  tokenId,
  name,
  ownerAddress,
  agentWallet,
  alreadyBoosted,
  onBoosted,
}: {
  chainId: string
  tokenId: string
  name: string
  ownerAddress: string
  agentWallet?: string | null
  alreadyBoosted: boolean
  onBoosted: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [status, setStatus] = useState<{
    eligible: boolean
    checks: { key: string; label: string; ok: boolean; detail?: string }[]
    missing: string[]
  } | null>(null)

  useEffect(() => {
    void getActiveAccount().then(setAccount)
    void getBoostStatus(Number(chainId), tokenId)
      .then((s) => setStatus({ eligible: s.eligible, checks: s.checks, missing: s.missing }))
      .catch(() => setStatus(null))
  }, [chainId, tokenId])

  const ownerSet = [ownerAddress, agentWallet]
    .filter((x): x is string => Boolean(x))
    .map((x) => x.toLowerCase())
  const isOwner = Boolean(account && ownerSet.includes(account.toLowerCase()))

  async function boost() {
    setPhase('busy')
    setMessage(null)
    try {
      const addr = account ?? (await connectWallet())
      setAccount(addr)
      if (!ownerSet.includes(addr.toLowerCase())) {
        setPhase('error')
        setMessage('Connect the wallet that owns this agent (registry owner or agent wallet).')
        return
      }
      if (!status?.eligible) {
        setPhase('error')
        setMessage(
          status?.missing?.length
            ? `Boost locked until the verifier checklist passes: ${status.missing.join(', ')}.`
            : 'Boost locked until the verifier checklist passes.',
        )
        return
      }

      const days = 7
      const nonce = `0x${Date.now().toString(16)}`
      const ownerForSig = (ownerAddress || addr).toLowerCase()
      const messageToSign = [
        'Agent Souk boost',
        `chainId: ${Number(chainId)}`,
        `tokenId: ${tokenId}`,
        `owner: ${ownerForSig}`,
        `days: ${days}`,
        `nonce: ${nonce}`,
      ].join('\n')
      const signature = (await (await getProvider()).request({
        method: 'personal_sign',
        params: [messageToSign, addr],
      })) as string

      const paymentId = window.prompt(
        'Paste a settled x402 paymentId from YOUR owner wallet (hire once as owner, then paste that payment id). 7 days.',
      )
      if (!paymentId?.trim()) {
        setPhase('idle')
        return
      }

      const result = await activateBoost({
        chainId: Number(chainId),
        tokenId,
        days,
        paymentId: paymentId.trim(),
        owner: addr,
        signature,
        nonce,
      })
      setPhase('done')
      setMessage(`Boosted until ${new Date(result.expiresAt).toLocaleString()}`)
      onBoosted()
    } catch (e) {
      setPhase('error')
      setMessage(hireErrorText(e))
    }
  }

  if (alreadyBoosted) {
    return (
      <div className="mt-6 rounded-[10px] border hairline border-highlighter-green/40 p-4">
        <p className="micro text-highlighter-green">Boosted listing</p>
        <p className="mt-2 text-[11px] leading-relaxed text-newsprint-gray">
          This agent sorts higher on the marketplace while the boost is active.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-[10px] border hairline border-slate-verdant/40 p-4">
      <p className="micro text-newsprint-gray">Boost this listing</p>
      <p className="mt-2 text-[11px] leading-relaxed text-newsprint-gray">
        Owner-only. You must meet the verifier checklist, sign as the registered
        owner, and pay with your own settled x402 receipt.
      </p>
      {status && !status.eligible && (
        <ul className="mt-3 space-y-1 text-[11px] text-newsprint-gray">
          {status.checks.map((c) => (
            <li key={c.key} className={c.ok ? 'text-highlighter-green' : 'text-press-black'}>
              {c.ok ? '✓' : '·'} {c.label}
              {!c.ok && c.detail ? ` · ${c.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
      {account && !isOwner && (
        <p className="mt-3 text-[11px] text-press-black">
          Connected wallet is not the owner of this agent.
        </p>
      )}
      <button
        type="button"
        onClick={() => void boost()}
        disabled={phase === 'busy' || (status !== null && !status.eligible)}
        className="micro mt-3 w-full rounded-[5px] border hairline border-highlighter-green/50 px-3 py-2 text-highlighter-green transition hover:bg-highlighter-green/10 disabled:opacity-50"
      >
        {phase === 'busy'
          ? 'Activating…'
          : status && !status.eligible
            ? 'Boost locked'
            : `Boost ${name}`}
      </button>
      {message && (
        <p className={`mt-2 text-[11px] ${phase === 'error' ? 'text-press-black' : 'text-newsprint-gray'}`}>
          {message}
        </p>
      )}
    </div>
  )
}

function HirePanel({
  chainId,
  tokenId,
  name,
  onHired,
}: {
  chainId: string
  tokenId: string
  name: string
  onHired: () => void
}) {
  const [step, setStep] = useState<HireStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [requirements, setRequirements] = useState<PaymentRequirements | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [agent, setAgent] = useState<HireRequirementsData['agent'] | null>(null)
  const [result, setResult] = useState<SettleResult | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  async function startHire() {
    setError(null)
    setStep('connecting')
    try {
      // pin the wallet to this agent's chain before connecting, so connect and
      // signature both target the chain the requirements will name
      setTargetChain(Number(chainId))
      const addr = await connectWallet()
      await ensureBscChain()
      // deliberately no smart-account gate at connect time: see the note in
      // lib/hire.ts. the facilitator is the authority on whether a signature is
      // recoverable, and the heuristic refusal blocked EOA wallets outright.
      setAccount(addr)
      const data = await fetchHireRequirements(
        { chainId: Number(chainId), tokenId: Number(tokenId), name },
        { address: addr },
      )
      setRequirements(data.paymentRequirements)
      setPreview(data.preview)
      setAgent(data.agent)
      setStep('preview')
    } catch (e) {
      setError(hireErrorText(e))
      setStep('idle')
    }
  }

  async function signAndSettle() {
    if (!requirements || !preview || !agent || !account) return
    setError(null)
    const outcome = await signAndSettleHire(
      { paymentRequirements: requirements, preview, agent },
      (phase) => setStep(phase),
    )
    if (outcome.success && outcome.settle) {
      setResult(outcome.settle)
      if (outcome.receipt) setReceipt(outcome.receipt)
      onHired()
    } else {
      setError(outcome.error ?? 'Something went wrong.')
      setStep('preview')
    }
  }

  function reset() {
    setStep('idle')
    setError(null)
    setRequirements(null)
    setPreview(null)
    setAgent(null)
    setResult(null)
    setReceipt(null)
  }

  const option = preview?.options[0]

  return (
    <div className="mt-6">
      {step === 'idle' && (
        <button
          type="button"
          onClick={startHire}
          className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-5 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Hire {name}
        </button>
      )}

      {step === 'connecting' && (
        <button
          type="button"
          disabled
          className="micro w-full rounded-[5px] bg-highlighter-green/60 px-6 py-5 text-typesetter-ink"
        >
          Connecting wallet…
        </button>
      )}

      {(step === 'preview' || step === 'signing' || step === 'settling') && option && preview && (
        <div className="rounded-[10px] border hairline border-slate-verdant/40 p-4">
          <div className="space-y-2 text-xs">
            <Row label="Price" value={`$${option.amountUsd} ${option.tokenSymbol}`} mono />
            <Row label="To" value={shortAddress(option.payTo)} mono />
            <Row label="For" value={preview.resource.description} />
          </div>
          {step === 'preview' ? (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={signAndSettle}
                className="micro w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                Sign &amp; activate
              </button>
              <button
                type="button"
                onClick={reset}
                className="micro w-full rounded-[5px] border hairline border-slate-verdant/50 px-4 py-3 text-newsprint-gray transition hover:text-press-black"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const addr = await changeWallet()
                    if (addr) setAccount(addr)
                  } catch (e) {
                    setError(hireErrorText(e))
                  }
                }}
                className="micro w-full px-4 py-1 text-center text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                Change wallet
              </button>
              <button
                type="button"
                onClick={() => {
                  // a wallet that cannot hire must not be a dead end: forget the
                  // choice and the derived session, then offer connect again
                  disconnectWallet()
                  setAccount(null)
                  setStep('idle')
                  setRequirements(null)
                  setError(null)
                }}
                className="micro w-full px-4 py-1 text-center text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <p className="micro mt-4 text-center text-newsprint-gray">
              {step === 'signing' ? 'Waiting for signature…' : 'Settling…'}
            </p>
          )}
        </div>
      )}

      {step === 'hired' && result && (
        <div className="rounded-[10px] border hairline border-highlighter-green/50 p-4">
          <p className="micro text-highlighter-green">Agent activated</p>
          <div className="mt-3 space-y-2 text-xs">
            <Row label="Payment" value={result.paymentId} mono />
            {receipt && (
              <>
                <Row label="Session cap" value={`$${receipt.session.spendCapUsd} · until ${formatDate(receipt.session.expiresAt)}`} />
                <Row
                  label="Settlement"
                  value={receipt.mode === 'b402' ? 'BNB Chain (x402)' : 'Sandbox facilitator'}
                />
              </>
            )}
          </div>
          {result.txHash && (
            <p className="mt-3 break-all font-mono text-[10px] text-newsprint-gray">
              {receipt?.mode === 'b402' ? (
                <a
                  href={`${explorerBase(chainId)}/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-press-black hover:text-highlighter-green"
                >
                  {result.txHash}
                </a>
              ) : (
                result.txHash
              )}
            </p>
          )}
          {(!receipt || receipt.mode === 'sandbox') && (
            <p className="mt-3 text-[11px] leading-relaxed text-newsprint-gray">
              Sandbox settlement: the signature was verified and the session is
              recorded by the facilitator; no on-chain transfer occurred. Live
              BNB settlement uses the same flow, with the relay broadcasting the
              authorization to the agent's own wallet.
            </p>
          )}
          <DeliveryPanel paymentId={result.paymentId} />
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs leading-relaxed text-press-black">
          {error}
        </p>
      )}
    </div>
  )
}

function skeletonArgs(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: string }>
  const required = (schema.required ?? []) as string[]
  const skeleton: Record<string, unknown> = {}
  for (const key of required) {
    const t = props[key]?.type
    skeleton[key] = t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : ''
  }
  return JSON.stringify(skeleton, null, 2)
}

function DeliveryPanel({ paymentId }: { paymentId: string }) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked'>('idle')
  const [data, setData] = useState<DeliverData | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [tool, setTool] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [taskText, setTaskText] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [hireTask, setHireTask] = useState<HireTask | null>(null)
  const [retrying, setRetrying] = useState(false)

  async function loadCapabilities() {
    setPhase('loading')
    setBlocked(null)
    try {
      const d = await deliverTask({ paymentId })
      setData(d)
      const first = d.tools?.[0]
      if (first) {
        setTool(first.name)
        setArgsText(skeletonArgs(first.schema))
      }
      setPhase('ready')
    } catch (e) {
      setBlocked(hireErrorText(e))
      setPhase('blocked')
    }
  }

  async function refreshTask(taskId: string) {
    const payload = await getTask(taskId)
    if (payload?.task) setHireTask(payload.task)
  }

  async function run() {
    setRunning(true)
    setRunError(null)
    setOutput(null)
    try {
      const body = tool
        ? { paymentId, tool, args: JSON.parse(argsText || '{}') as Record<string, unknown> }
        : { paymentId, task: taskText }
      const d = await deliverTask(body)
      setOutput(d.text || '(the agent returned no text)')
      if (d.error) setRunError(d.error)
      if (d.taskId) await refreshTask(d.taskId)
    } catch (e) {
      setRunError(hireErrorText(e))
    } finally {
      setRunning(false)
    }
  }

  async function retry() {
    if (!hireTask) return
    setRetrying(true)
    setRunError(null)
    try {
      const t = await retryTask(hireTask.id)
      if (t) {
        setHireTask(t)
        setOutput(t.result ?? output)
        if (t.error) setRunError(t.error)
      }
    } catch (e) {
      setRunError(hireErrorText(e))
    } finally {
      setRetrying(false)
    }
  }

  const tools: DeliverTool[] = data?.tools ?? []
  const selected = tools.find((t) => t.name === tool)

  return (
    <div className="mt-4 rounded-[10px] border hairline border-slate-verdant/40 p-4">
      <p className="micro text-newsprint-gray">Run a task</p>

      {hireTask && (
        <div className="mt-3 rounded-[8px] border hairline border-slate-verdant/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="micro text-newsprint-gray">Task {hireTask.status}</span>
            <span className="micro text-newsprint-gray">
              attempt {hireTask.attempts}/{hireTask.maxAttempts}
            </span>
          </div>
          {hireTask.quality && (
            <p className="mt-2 text-[11px] text-newsprint-gray">
              quality {hireTask.quality.grade} ({hireTask.quality.score})
              {hireTask.quality.reason ? ` · ${hireTask.quality.reason}` : ''}
            </p>
          )}
          {hireTask.status === 'failed' && hireTask.attempts < hireTask.maxAttempts && (
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="micro mt-3 w-full rounded-[5px] border hairline border-slate-verdant/50 px-3 py-2 text-press-black transition hover:border-press-black disabled:opacity-60"
            >
              {retrying ? 'Retrying…' : 'Retry delivery'}
            </button>
          )}
        </div>
      )}

      {phase === 'idle' && (
        <button
          type="button"
          onClick={loadCapabilities}
          className="micro mt-3 w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Load capabilities
        </button>
      )}

      {phase === 'loading' && <p className="micro mt-3 text-newsprint-gray">Loading capabilities…</p>}

      {blocked && (
        <p className="mt-3 text-[11px] leading-relaxed text-newsprint-gray">{blocked}</p>
      )}

      {phase === 'ready' && data && (
        <>
          {tools.length > 0 ? (
            <div className="mt-3 space-y-2">
              <select
                value={tool}
                onChange={(e) => {
                  setTool(e.target.value)
                  const t = tools.find((x) => x.name === e.target.value)
                  if (t) setArgsText(skeletonArgs(t.schema))
                }}
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-[11px] text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                {tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selected?.description && (
                <p className="text-[11px] leading-relaxed text-newsprint-gray">{selected.description}</p>
              )}
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={5}
                spellCheck={false}
                aria-label="Tool arguments as JSON"
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-[11px] leading-relaxed text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              />
              <button
                type="button"
                onClick={run}
                disabled={running}
                className="micro w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                {running ? 'Running…' : `Run ${tool}`}
              </button>
            </div>
          ) : data.protocol === 'a2a' ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                rows={3}
                placeholder="Describe the task for this agent…"
                aria-label="Task description"
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-xs leading-relaxed text-press-black placeholder:text-newsprint-gray/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              />
              <button
                type="button"
                onClick={run}
                disabled={running || !taskText.trim()}
                className="micro w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-typesetter-ink shadow transition hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                {running ? 'Running…' : 'Run task'}
              </button>
            </div>
          ) : null}

          <p className="mt-3 text-[10px] leading-relaxed text-newsprint-gray/70">
            Delivery is gated on your settled session; the marketplace relays the
            call to the agent&apos;s own endpoint.
          </p>
        </>
      )}

      {runError && (
        <p className="mt-3 rounded-[8px] border hairline border-press-black/20 bg-bone-white p-3 text-[11px] leading-relaxed text-press-black">
          {runError}
        </p>
      )}

      {output && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] border hairline border-slate-verdant/40 bg-bone-white p-3 font-mono text-[11px] leading-relaxed text-press-black">
          {output}
        </pre>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="micro shrink-0 text-newsprint-gray">{label}</span>
      <span className={`text-right text-press-black ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}

// the scan records what the agent's own get_performance endpoint returned; we
// publish it verbatim and label it clearly, no math on the claims
// placeholder PnL shell: layout ships now, live numbers land with verified
// report endpoints and our own Studio agents
function PnlComingSoon({ name }: { name: string }) {
  return (
    <div className="relative mt-6 overflow-hidden rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="micro text-newsprint-gray">Performance / PnL</h2>
        <span className="micro rounded-full border hairline border-highlighter-green/50 bg-highlighter-green/10 px-2.5 py-1 text-highlighter-green">
          Coming soon
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-newsprint-gray">
        Verified PnL for {name} will appear here once the agent reports through a
        performance endpoint and marketplace probes confirm the numbers. Sample
        layout only, not live data.
      </p>
      <div className="pointer-events-none mt-6 select-none blur-[6px]" aria-hidden="true">
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: '30d PnL', value: '+12.4%' },
            { label: 'Win rate', value: '68%' },
            { label: 'Max drawdown', value: '-4.1%' },
            { label: 'Sharpe', value: '1.82' },
          ].map((m) => (
            <div key={m.label} className="rounded-[10px] border hairline border-slate-verdant/30 p-4">
              <div className="micro text-newsprint-gray">{m.label}</div>
              <div className="mt-2 font-serif text-[28px] leading-none text-press-black">{m.value}</div>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 640 160" className="mt-6 h-36 w-full" role="presentation">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-highlighter-green"
            points="0,120 40,110 80,125 120,90 160,100 200,70 240,85 280,55 320,65 360,40 400,50 440,35 480,45 520,28 560,38 600,22 640,30"
          />
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-slate-verdant"
            strokeDasharray="4 4"
            points="0,130 640,100"
          />
        </svg>
      </div>
      <p className="mt-6 text-[11px] leading-relaxed text-newsprint-gray/80">
        Sample figures are illustrative and blurred on purpose. Do not treat them
        as this agent&apos;s record.
      </p>
    </div>
  )
}

function PerformanceSection({ probe }: { probe: PerformanceProbe }) {
  const raw = probe.rawOutput ?? ''
  const truncated = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw

  return (
    <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <h2 className="micro text-newsprint-gray">Self-reported performance</h2>
      <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
        Self-reported by the agent&apos;s own endpoint. Not verified by Agent
        Souk.
      </p>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 font-mono text-[11px] leading-relaxed text-press-black">
        {truncated}
      </pre>
      {raw.length > 400 && (
        <details className="mt-3">
          <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
            Full response from {probe.tool ?? 'the agent'}
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 font-mono text-[11px] leading-relaxed text-press-black">
            {raw}
          </pre>
        </details>
      )}
    </div>
  )
}

function BigMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="micro text-newsprint-gray">{label}</div>
      <div className={`mt-2 truncate font-serif text-[28px] leading-none ${accent ? 'text-highlighter-green' : 'text-press-black'}`}>
        {value}
      </div>
    </div>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="micro text-newsprint-gray">{label}</span>
        <span className="tabular-nums text-press-black">{formatScore(value)}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-verdant/15">
        <div
          className="h-full rounded-full bg-highlighter-green"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Endpoint({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="micro text-newsprint-gray">{label}</span>
      {value ? (
        <a
          href={value.startsWith('http') ? value : undefined}
          target={value.startsWith('http') ? '_blank' : undefined}
          rel="noreferrer"
          className="max-w-[220px] truncate font-mono text-[11px] text-press-black hover:text-highlighter-green"
        >
          {value}
        </a>
      ) : (
        <span className="text-xs text-newsprint-gray/60">n/a</span>
      )}
    </div>
  )
}