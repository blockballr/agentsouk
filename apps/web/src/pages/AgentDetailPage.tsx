import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { AgentDetail, PaymentRequirements, PreviewResult, Receipt, SettleResult } from '@agora/core'
import {
  formatDate,
  formatNumber,
  formatScore,
  SESSION_HOURS,
  SESSION_SPEND_CAP_USD,
  shortAddress,
  timeAgo,
  JOB_SELLER_NOTE,
  sellsByJob,
} from '@agora/core'
import { activateBoost, actOnJob, deliverTask, getAgentDetail, getBoostStatus, getHiresByWallet, getJobByPayment, getTask, getTasksByPayment, retryTask, type DeliverData, type DeliverTool, type HireTask, type JobStatus } from '../lib/api'
import { TestTokens } from '../components/TestTokens'
import { questStepFor } from '../lib/quest'
import { chainLabel } from '../lib/contracts'
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
  deliveryErrorText,
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

// chain 97 has no paid-hire verifier: its delivered verdicts come from the scout
// liveness probe in probeToVerification, so they are reachability rather than delivery
const BSC_TESTNET_CHAIN_ID = 97

function isProbeCheck(chainId: number, quality?: { model: string }): boolean {
  if (quality?.model === 'deterministic') return true
  return chainId === BSC_TESTNET_CHAIN_ID && !quality
}

function verificationLabel(status: string, probe: boolean): string {
  if (status === 'dead') return 'stale'
  if (status !== 'delivered') return status
  return probe ? 'endpoint reachable' : 'verified delivered'
}

// the listing stays on the shelf, so a buyer about to sign is told what the last
// check found, because settlement does not wait for the agent to answer
export function preHireWarning(verification?: { status: string; checkedAt: string }): string | null {
  if (!verification) return null
  const found =
    verification.status === 'dead'
      ? 'got no usable answer from this agent'
      : verification.status === 'unreachable'
        ? 'found no endpoint it can call'
        : verification.status === 'gated'
          ? 'found the endpoint behind its own access gate'
          : null
  if (!found) return null
  return `The marketplace last checked this agent on ${verification.checkedAt.slice(0, 10)} and ${found}. Payment settles to the agent's wallet when you sign, before it is asked for anything.`
}

// 8004scan's health probe arrives with the registry data while the verdict comes
// from our own check, so each date names whose check it is
export function freshnessLine(
  updatedAt: string | null | undefined,
  scanCheckedAt: string | null | undefined,
  ourCheckedAt: string | null | undefined,
  ago: (iso: string) => string = timeAgo,
): string {
  const record = `Registry record last updated ${updatedAt ? ago(updatedAt) : 'unknown'}.`
  const ours = ourCheckedAt ? `the marketplace on ${ourCheckedAt.slice(0, 10)}` : null
  if (scanCheckedAt && ours) return `${record} Endpoint probed by 8004scan ${ago(scanCheckedAt)}, and by ${ours}.`
  if (scanCheckedAt) return `${record} Endpoint probed by 8004scan ${ago(scanCheckedAt)}.`
  if (ours) return `${record} Endpoint checked by ${ours}.`
  return record
}

function explorerBase(chainId: string): string {
  // compared as a number: the route parameter arrives as a string
  return Number(chainId) === 97 ? 'https://testnet.bscscan.com' : 'https://bscscan.com'
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
  paymentId: string
  client: string
}

export interface PerformanceProbe {
  tokenId: string
  status: string
  tool?: string
  rawOutput?: string
  scannedAt?: string
}

// self-reported performance comes from the committed scan output; a failed fetch hides the section
async function fetchPerformanceProbe(
  tokenId: string,
): Promise<PerformanceProbe | null> {
  try {
    const base = import.meta.env.VITE_API_URL ?? '/api'
    const res = await fetch(`${base}/performance`)
    if (!res.ok) return null
    const body: {
      success?: boolean
      data?: { probeResults?: PerformanceProbe[]; scannedAt?: string }
    } = await res.json()
    if (!body.success || !body.data?.probeResults) return null
    const probe = body.data.probeResults.find(
      (p) => p.tokenId === tokenId && p.status === 'probed' && p.rawOutput,
    )
    if (!probe) return null
    // carried onto the record so the section can date itself
    return { ...probe, scannedAt: body.data.scannedAt }
  } catch {
    return null
  }
}

type DetailWithSession = AgentDetail & {
  activeSession?: ActiveSession
  // the web service the registry record declared; browser-invoked, never called by the marketplace
  web_endpoint?: string | null
}

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

// chainLabel lives in lib/contracts so the network is named in one place.

// A listed agent is either answering, not answering, or not yet swept. The upstream
// index saying nothing is not a status, so it is never rendered as one: our own
// verifier's reading comes first, then a real index reading, then the sweep state.
// The reading and its provenance are kept separate so the metric box can show the
// word large and the check time as a caption instead of clipping a sentence.
function statusFor(detail: AgentDetail): { value: string; note?: string } {
  const v = detail.verification
  if (v?.status) {
    return v.checkedAt ? { value: v.status, note: `checked ${formatDate(v.checkedAt)}` } : { value: v.status }
  }
  const upstream = (detail.health_status ?? '').trim()
  if (upstream && upstream.toLowerCase() !== 'unknown') return { value: upstream, note: 'from the index' }
  return { value: detail.is_active ? 'not yet swept' : 'inactive' }
}

// covers all three modes, so a production hire is never labelled sandboxed
function settlementLabel(mode: ActiveSession['mode'] | undefined): string {
  if (mode === 'b402') return 'BNB Chain (x402)'
  if (mode === 'sandbox') return 'Sandbox facilitator, nothing broadcast'
  return 'Production relay, broadcast on chain'
}

// a hash is only a transaction when something was broadcast; sandbox strings are synthetic
// a listing belongs to whoever the registry records as owner, or the agent wallet
function isListingOwner(
  account: string,
  detail: { owner_address?: string | null; agent_wallet?: string | null },
): boolean {
  const a = account.toLowerCase();
  return (
    (!!detail.owner_address && detail.owner_address.toLowerCase() === a) ||
    (!!detail.agent_wallet && detail.agent_wallet.toLowerCase() === a)
  );
}

function isOnchainSettlement(mode: ActiveSession['mode'] | undefined): boolean {
  return mode === 'prod' || mode === 'b402'
}

export function AgentDetailPage() {
  const { chainId = '56', tokenId = '' } = useParams()
  const [searchParams] = useSearchParams()
  // a passport link opens the page ready for its step: a way back, and the run panel filled in
  const quest = questStepFor(searchParams.get('quest'), Number(chainId), tokenId)
  const questPrefill = quest
    ? { task: quest.agent.task, input: quest.agent.input ? JSON.stringify(quest.agent.input) : undefined }
    : undefined
  const [detail, setDetail] = useState<DetailWithSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [perfProbe, setPerfProbe] = useState<PerformanceProbe | null>(null)
  // the connected viewer, so owner-only affordances can be hidden from everyone else
  const [viewer, setViewer] = useState<string | null>(null)
  // the viewer's live hire for this agent, found through the receipts store rather
  // than the instance's own ledger
  const [durableHire, setDurableHire] = useState<{ paymentId: string } | null>(null)
  // the last run's deliverable and job, lifted out of the sidebar so the result
  // renders full width in the main column instead of inside the narrow hire form
  const [runResult, setRunResult] = useState<{
    output: string | null
    job: { id: string; status: JobStatus } | null
    task: HireTask | null
  } | null>(null)
  // phones stack the hire panel under the details, so a bottom bar carries its
  // action until the panel itself is on screen
  const [hirePanel, setHirePanel] = useState<HTMLElement | null>(null)
  const [hireInView, setHireInView] = useState(false)

  useEffect(() => {
    void getActiveAccount().then(setViewer)
  }, [])

  useEffect(() => {
    if (!hirePanel) return
    const seen = new IntersectionObserver(([entry]) => setHireInView(entry.isIntersecting), { threshold: 0.1 })
    seen.observe(hirePanel)
    return () => seen.disconnect()
  }, [hirePanel])

  // The agent's active session can only be seen by the instance that settled it,
  // because that ledger lives in memory. The wallet's own hires come from the
  // receipts store instead, so a session is found even when another instance
  // answered the request and the page would otherwise offer to sell it again.
  useEffect(() => {
    if (!viewer) {
      setDurableHire(null)
      return
    }
    let cancelled = false
    getHiresByWallet(viewer)
      .then((hires) => {
        if (cancelled) return
        const now = Date.now()
        const mine = hires
          .filter((h) => String(h.chainId) === String(chainId) && String(h.tokenId) === String(tokenId))
          .filter((h) => !h.expiresAt || new Date(h.expiresAt).getTime() > now)
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
        setDurableHire(mine[0] ? { paymentId: mine[0].paymentId } : null)
      })
      .catch(() => {
        // a failed lookup must not turn into a claim: fall back to the ledger only
        if (!cancelled) setDurableHire(null)
      })
    return () => {
      cancelled = true
    }
  }, [viewer, chainId, tokenId])

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
          className="micro mt-8 inline-block rounded-[5px] bg-highlighter-green px-6 py-3 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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
  const activeSession = detail.activeSession
  // only the wallet that bought the session is offered its run controls; another
  // viewer keeps the hire panel, because the session is not theirs to spend
  // a session is shown only to the wallet that bought it; anyone else sees an ordinary hire panel
  const ownSession =
    activeSession && viewer && activeSession.client.toLowerCase() === viewer.toLowerCase() ? activeSession : null
  const mySession = ownSession ? { paymentId: ownSession.paymentId } : durableHire
  const verificationProbe = detail.verification
    ? isProbeCheck(detail.chain_id, detail.verification.quality)
    : false
  const hireWarning = preHireWarning(detail.verification)
  const jobSeller = sellsByJob(detail.skills)

  function refreshDetail() {
    getAgentDetail(chainId, tokenId)
      .then((d) => {
        if (d) setDetail(d)
      })
      .catch(() => {})
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-28 pt-10 lg:pb-10">
      {!hireInView && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t hairline border-slate-verdant/40 bg-press-black px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden">
          <button
            type="button"
            onClick={() => hirePanel?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="micro flex min-h-11 w-full items-center justify-center rounded-[5px] bg-highlighter-green px-4 text-on-highlighter focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-white"
          >
            {mySession ? 'Run a task in your session' : jobSeller ? 'How this agent is hired' : `Hire ${detail.name}`}
          </button>
        </div>
      )}
      <Link
        to="/agents"
        className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
      >
        ← Marketplace
      </Link>
      {quest && (
        <div role="note" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-press-black px-4 py-3 text-sm">
          <span>
            Souk passport · <span className="font-medium">{quest.step.title} stamp</span> · +{quest.step.points}. Hire this agent,
            then run the task already filled in below.
          </span>
          <Link to="/quest" className="micro underline underline-offset-4 transition hover:text-press-black">
            Back to your passport
          </Link>
        </div>
      )}

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
                  <span className="micro rounded-full bg-highlighter-green px-2.5 py-1 text-on-highlighter">
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
                        ? verificationProbe
                          ? `Deterministic probe: ${detail.verification.quality.grade} - ${detail.verification.quality.reason} (checked ${detail.verification.checkedAt.slice(0, 10)})`
                          : `AI review: ${detail.verification.quality.grade} - ${detail.verification.quality.reason} (checked ${detail.verification.checkedAt.slice(0, 10)})`
                        : verificationProbe && detail.verification.status === 'delivered'
                          ? `Endpoint answered a liveness probe (checked ${detail.verification.checkedAt})`
                          : `Shopper checked ${detail.verification.checkedAt}`
                    }
                    className={`micro rounded-full border hairline px-2.5 py-1 ${verificationTone[detail.verification.status] ?? verificationTone.dead}`}
                  >
                    {verificationLabel(detail.verification.status, verificationProbe)} · {detail.verification.checkedAt.slice(0, 10)}
                  </span>
                )}
                {detail.verification?.status === 'delivered' && detail.verification.concurrency === 'parallel-ok' && (
                  <span
                    title="verified: two simultaneous calls both answered"
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
                <BigMetric label="Feedback" value={formatNumber(detail.total_feedbacks)} />
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
                  <BigMetric label="Status" value={statusFor(detail).value} note={statusFor(detail).note} />
                </div>
              </div>

              {detail.skills && detail.skills.length > 0 && (
                <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
                  <h2 className="micro text-newsprint-gray">What this agent expects</h2>
                  <div className="mt-4 space-y-5">
                    {detail.skills.map((s) => (
                      <div key={s.id ?? s.name ?? 'skill'}>
                        {s.inputSchema?.properties && (
                          <dl className="space-y-1.5">
                            {Object.entries(s.inputSchema.properties).map(([field, meta]) => (
                              <div key={field} className="flex items-baseline justify-between gap-4">
                                <dt className="shrink-0 font-mono text-xs text-press-black">
                                  {field}
                                  {s.inputSchema?.required?.includes(field) ? (
                                    <span className="text-highlighter-green"> *</span>
                                  ) : null}
                                </dt>
                                <dd className="text-right text-xs text-newsprint-gray">{meta.description}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {s.inputSchema?.examples && s.inputSchema.examples.length > 0 && (
                          <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-newsprint-gray">
                            send {JSON.stringify(s.inputSchema.examples[0])}
                          </p>
                        )}
                        {!s.inputSchema && (
                          <>
                            {s.examples && s.examples.length > 0 && (
                              <ul className="space-y-1 text-[13px] leading-relaxed text-newsprint-gray">
                                {s.examples.map((e) => (
                                  <li key={e}>{e}</li>
                                ))}
                              </ul>
                            )}
                            {s.inputModes && s.inputModes.length > 0 && (
                              <p className="mt-2 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
                                accepts {s.inputModes.join(', ')}
                              </p>
                            )}
                          </>
                        )}
                        {s.outputSchema?.properties && (
                          <div className="mt-3">
                            <p className="micro text-newsprint-gray">Returns</p>
                            <dl className="mt-2 space-y-1.5">
                              {Object.entries(s.outputSchema.properties).map(([field, meta]) => (
                                <div key={field} className="flex items-baseline justify-between gap-4">
                                  <dt className="shrink-0 font-mono text-xs text-press-black">{field}</dt>
                                  <dd className="text-right text-xs text-newsprint-gray">{meta.description}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-[14px] border hairline border-slate-verdant/40 p-8">
                <h2 className="micro text-newsprint-gray">Endpoints</h2>
                <EndpointPanel detail={detail} />
              </div>
            </div>
          </div>

          {perfProbe && <PerformanceSection probe={perfProbe} />}

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

          {runResult && (runResult.output || runResult.task || runResult.job) && (
            <ResultPanel result={runResult} />
          )}
        </div>

        <aside
          ref={setHirePanel}
          className="h-fit scroll-mt-4 rounded-[14px] border hairline border-slate-verdant/40 p-8 lg:sticky lg:top-8"
        >
          {ownSession && (
            <div className="score-strip mb-6 rounded-[10px] p-4" role="status">
              <p className="micro text-press-black">Session active</p>
              <div className="mt-3 space-y-2 text-xs">
                <Row label="Spend cap" value={`$${ownSession.spendCapUsd}`} />
                <Row label="Expires" value={formatExpiry(ownSession.expiresAt)} />
                <Row label="Mode" value={sessionModeLabel(ownSession.mode)} />
              </div>
            </div>
          )}
          <h2 className="micro text-newsprint-gray">
            {mySession ? 'Run a task in your session' : 'Hire this agent'}
          </h2>
          <div className="mt-6 space-y-4 text-[11px] uppercase tracking-[0.01em] text-newsprint-gray">
            <div className="flex justify-between">
              <span>Model</span>
              <span className="text-press-black">Pay per request</span>
            </div>
            <div className="flex justify-between">
              <span>Session</span>
              {/* reflects what the facilitator actually sets on the session,
                  rather than a second opinion in the markup: this said $10 while
                  production issued $5, so a live session contradicted the page */}
              <span className="text-press-black">
                {SESSION_HOURS}h · ${SESSION_SPEND_CAP_USD} cap
              </span>
            </div>
            <div className="flex justify-between">
              <span>Network</span>
              <span className="text-press-black">{chainLabel(Number(chainId))}</span>
            </div>
          </div>
          {/* A wallet that already holds a live session should land on the run
              controls rather than on a second signature: the session is already
              bought, so offering the hire again invites paying twice for it. */}
          {mySession ? (
            <div className="mt-6">
              <DeliveryPanel paymentId={mySession.paymentId} onResult={setRunResult} prefill={questPrefill} />
            </div>
          ) : jobSeller ? (
            <p role="note" className="mt-6 rounded-[8px] border hairline border-slate-verdant/45 p-3 text-xs leading-relaxed text-press-black">
              {JOB_SELLER_NOTE}
            </p>
          ) : (
            <>
              {hireWarning && (
                <p role="note" className="mt-6 rounded-[8px] border hairline border-slate-verdant/45 p-3 text-xs leading-relaxed text-newsprint-gray">
                  {hireWarning}
                </p>
              )}
              <HirePanel chainId={chainId} tokenId={detail.token_id} name={detail.name} onHired={refreshDetail} prefill={questPrefill} />
            </>
          )}
          {!jobSeller && (
            <p className="mt-4 text-xs leading-relaxed text-newsprint-gray">
              You sign a gasless transfer authorization; a facilitator verifies and
              settles it on-chain. Funds go straight to the agent&apos;s wallet.
            </p>
          )}
          {/* owner-only, so it renders only for an owner */}
          {viewer && isListingOwner(viewer, detail) && (
            <BoostPanel
              chainId={chainId}
              tokenId={detail.token_id}
              name={detail.name}
              ownerAddress={detail.owner_address}
              agentWallet={detail.agent_wallet}
              alreadyBoosted={Boolean((detail as { boosted?: boolean }).boosted)}
              onBoosted={refreshDetail}
            />
          )}
          {/* permissions precede the registry evidence: they are part of the buying decision,
              and a job seller is not bought this way, so it shows none */}
          {!jobSeller && (
          <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
            <h2 className="micro text-newsprint-gray">What you are authorising</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-newsprint-gray">
              <li>
                One EIP-3009 transfer authorization for the hire amount, scoped to this agent&apos;s
                wallet. Nothing is approved for later, and there is no blanket token approval.
              </li>
              <li>
                A session capped at ${SESSION_SPEND_CAP_USD} and expiring in {SESSION_HOURS} hours.
                Every later call draws on that cap until you revoke it.
              </li>
              <li>
                {detail.mcp_server
                  ? 'The agent is invoked over MCP, so it can call the tools it publishes.'
                  : detail.a2a_endpoint
                    ? 'The agent is invoked over A2A, so it receives the messages you send it.'
                    : detail.web_endpoint
                      ? 'This agent is browser-invoked: its tools live in a browser page, so the marketplace cannot call it and a hire cannot run automatically.'
                      : 'No callable endpoint is published for this agent.'}
              </li>
            </ul>
          </div>
          )}

          {/* registry id and creation transaction, so a listing can be checked against the chain */}
          {(detail.agent_id || detail.created_tx_hash) && (
            <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
              <h2 className="micro text-newsprint-gray">Registry record</h2>
              <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
                This listing is an ERC-8004 registration. Check it against the registry and the
                transaction that created it.
              </p>
              <dl className="mt-5 space-y-3">
                {detail.agent_id && (
                  <div>
                    <dt className="micro text-newsprint-gray">Registry ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-press-black">
                      {detail.agent_id}
                    </dd>
                  </div>
                )}
                {detail.contract_address && (
                  <div>
                    <dt className="micro text-newsprint-gray">Registry contract</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      <a
                        href={`${explorerBase(chainId)}/address/${detail.contract_address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-press-black hover:text-highlighter-green"
                      >
                        {detail.contract_address}
                      </a>
                    </dd>
                  </div>
                )}
                {detail.created_tx_hash && (
                  <div>
                    <dt className="micro text-newsprint-gray">Registration transaction</dt>
                    <dd className="mt-1 break-all font-mono text-xs">
                      <a
                        href={`${explorerBase(chainId)}/tx/${detail.created_tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-press-black hover:text-highlighter-green"
                      >
                        {detail.created_tx_hash}
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="micro text-newsprint-gray">Freshness</dt>
                  <dd className="mt-1 text-xs text-press-black">
                    {freshnessLine(detail.updated_at, detail.health_checked_at, detail.verification?.checkedAt)}
                  </dd>
                </div>
              </dl>
            </div>
          )}

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
  prefill,
}: {
  chainId: string
  tokenId: string
  name: string
  onHired: () => void
  prefill?: { task?: string; input?: string }
}) {
  const [step, setStep] = useState<HireStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [requirements, setRequirements] = useState<PaymentRequirements | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [agent, setAgent] = useState<HireRequirementsData['agent'] | null>(null)
  const [result, setResult] = useState<SettleResult | null>(null)
  // catch the shortfall before the signature, saving a wasted signature and a reverted tx
  const [shortForHire, setShortForHire] = useState(false)
  const [nudge, setNudge] = useState(0)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  async function startHire() {
    setError(null)
    setStep('connecting')
    try {
      // pin the wallet to this agent's chain before connecting
      setTargetChain(Number(chainId))
      const addr = await connectWallet()
      await ensureBscChain()
      // no smart-account gate: the facilitator is the authority (see lib/hire.ts)
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
          className="micro w-full rounded-[5px] bg-highlighter-green px-6 py-5 text-on-highlighter shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Hire {name}
        </button>
      )}

      {step === 'connecting' && (
        <button
          type="button"
          disabled
          className="micro w-full rounded-[5px] bg-highlighter-green/60 px-6 py-5 text-on-highlighter"
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
              {shortForHire && (
                <p className="rounded-[10px] border border-highlighter-green/40 bg-highlighter-green/10 p-3 text-xs leading-relaxed text-highlighter-green">
                  This wallet does not hold enough sUSD for the ${option.amountUsd} hire. Get 10
                  free below, then sign.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  if (shortForHire) {
                    setNudge((n) => n + 1)
                    return
                  }
                  void signAndSettle()
                }}
                className={`micro w-full rounded-[5px] px-4 py-3 shadow transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black ${
                  shortForHire ? 'bg-highlighter-green/40 text-press-black' : 'bg-highlighter-green text-on-highlighter hover:brightness-95'
                }`}
              >
                {shortForHire ? (
                  // .micro uppercases, which would render the symbol as SUSD
                  <>
                    Get <span className="normal-case">sUSD</span> to activate
                  </>
                ) : (
                  'Sign & activate'
                )}
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
                  // a wallet that cannot hire must not be a dead end
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
                <Row label="Settlement" value={settlementLabel(receipt.mode)} />
              </>
            )}
          </div>
          {result.txHash && (
            <p className="mt-3 break-all font-mono text-[10px] text-newsprint-gray">
              {isOnchainSettlement(receipt?.mode) ? (
                <>
                  <a
                    href={`${explorerBase(chainId)}/tx/${result.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-press-black hover:text-highlighter-green"
                  >
                    {result.txHash}
                  </a>
                </>
              ) : (
                // labelled: this is derived from the payment id, not a transaction
                <>synthetic, not a transaction: {result.txHash}</>
              )}
            </p>
          )}
          {(!receipt || receipt.mode === 'sandbox') && (
            <p className="mt-3 text-[11px] leading-relaxed text-newsprint-gray">
              Sandbox settlement: the signature was verified and the session is
              recorded by the facilitator; no on-chain transfer occurred. Live
              Live settlement on {chainLabel(Number(chainId))} uses the same flow,
              with the relay broadcasting the authorization to the agent's own
              wallet.
            </p>
          )}
          <DeliveryPanel paymentId={result.paymentId} prefill={prefill} />
        </div>
      )}

      {error && (
        <>
          <p className="mt-4 rounded-[10px] border hairline border-press-black/20 bg-bone-white p-4 text-xs leading-relaxed text-press-black">
            {error}
          </p>
          {/* 0xe450d38c is ERC20InsufficientBalance. A raw viem revert string is
              not an explanation, so name the cause and point at what fixes it. */}
          {/e450d38c|InsufficientBalance|insufficient balance/i.test(error) && (
            <p className="mt-2 rounded-[10px] border border-highlighter-green/40 bg-highlighter-green/10 p-3 text-xs leading-relaxed text-highlighter-green">
              That failed because this wallet does not hold enough sUSD. Get 10 free below, then
              try again.
            </p>
          )}
        </>
      )}

      {/* outside the step blocks on purpose, so it stays available the moment a wallet lacks sUSD */}
      {step !== 'hired' && (
        <TestTokens
          chainId={Number(chainId)}
          account={account}
          onShortfall={setShortForHire}
          nudge={nudge}
        />
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

// an A2A agent may read a structured data part; the buyer pastes one JSON object.
// Empty is allowed (text-only flow unchanged), anything that is not a plain object
// is named inline rather than relayed.
function parseStructuredInput(
  raw: string,
): { ok: true; input?: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'This is not valid JSON. Paste an object such as {"walletAddress":"0x..."}.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Structured input must be a JSON object such as {"walletAddress":"0x..."}.' }
  }
  return { ok: true, input: parsed as Record<string, unknown> }
}

// The buyer's next step depends on what the server has the job at: only a
// Submitted job can be attested complete, a Funded one still needs delivery (or
// a refund), and a terminal job is done. A completion is never offered for a
// state the server has not confirmed.
export type CompletionOffer = 'complete' | 'refund' | 'none'

export function completionOffer(status: string | null | undefined): CompletionOffer {
  if (status === 'Submitted') return 'complete'
  if (status === 'Funded') return 'refund'
  return 'none'
}

// The x402 deliver response carries the ERC-8183 advance the server persisted,
// so the panel knows the job without a second read.
interface JobAdvance {
  advanced: boolean
  jobId?: string
  status?: JobStatus
  note?: string
}

function DeliveryPanel({
  paymentId,
  onResult,
  prefill,
}: {
  paymentId: string
  onResult?: (result: { output: string | null; job: { id: string; status: JobStatus } | null; task: HireTask | null }) => void
  prefill?: { task?: string; input?: string }
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'blocked'>('idle')
  const [data, setData] = useState<DeliverData | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [tool, setTool] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [taskText, setTaskText] = useState(prefill?.task ?? '')
  const [inputText, setInputText] = useState(prefill?.input ?? '')
  const [output, setOutput] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [hireTask, setHireTask] = useState<HireTask | null>(null)
  const [retrying, setRetrying] = useState(false)
  // the job the server reported after a delivery; null until one is confirmed
  const [job, setJob] = useState<{ id: string; status: JobStatus } | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [completeNote, setCompleteNote] = useState<string | null>(null)

  // hand the deliverable and job up so the page renders them full width
  useEffect(() => {
    onResult?.({ output, job: job ? { id: job.id, status: job.status } : null, task: hireTask })
  }, [output, job, hireTask, onResult])

  // a reload remounts this panel empty, so read back what the payment already
  // earned, and let a run that finished first keep its own state
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getTasksByPayment(paymentId).catch(() => [] as HireTask[]),
      getJobByPayment(paymentId).catch(() => null),
    ]).then(([tasks, stored]) => {
      if (cancelled) return
      const task = tasks[0]
      if (task) {
        setHireTask((cur) => cur ?? task)
        const result = task.result
        if (result) setOutput((cur) => cur ?? result)
      }
      if (stored) setJob((cur) => cur ?? { id: stored.id, status: stored.status })
    })
    return () => {
      cancelled = true
    }
  }, [paymentId])

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
      setBlocked(deliveryErrorText(e))
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
      // the structured input is optional; when malformed it blocks the run here
      // rather than reaching the API as a part the agent cannot read
      const structured = parseStructuredInput(inputText)
      if (!structured.ok) {
        setRunError(structured.error)
        return
      }
      const body = tool
        ? { paymentId, tool, args: JSON.parse(argsText || '{}') as Record<string, unknown> }
        : { paymentId, task: taskText, ...(structured.input ? { input: structured.input } : {}) }
      const d = (await deliverTask(body)) as DeliverData & { taskId?: string; jobAdvance?: JobAdvance }
      setOutput(d.text || '(the agent returned no text)')
      if (d.error) setRunError(d.error)
      if (d.taskId) await refreshTask(d.taskId)
      // the server persisted the ERC-8183 advance, so render what it reported
      if (d.jobAdvance?.jobId && d.jobAdvance.status) {
        setJob({ id: d.jobAdvance.jobId, status: d.jobAdvance.status })
      }
    } catch (e) {
      setRunError(deliveryErrorText(e))
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
      setRunError(deliveryErrorText(e))
    } finally {
      setRetrying(false)
    }
  }

  async function completeJob() {
    if (!job) return
    setCompleting(true)
    setCompleteError(null)
    setCompleteNote(null)
    try {
      const updated = await actOnJob(job.id, 'complete', { reason: 'complete' })
      // only what the server confirmed: the returned job is the new state
      setJob({ id: updated.id, status: updated.status })
      setCompleteNote('Completed. The deliverable is attested and the hire is closed.')
    } catch (e) {
      // the server's own reason, rather than a generic failure
      setCompleteError((e as Error).message)
    } finally {
      setCompleting(false)
    }
  }

  const tools: DeliverTool[] = data?.tools ?? []
  const selected = tools.find((t) => t.name === tool)
  const structured = parseStructuredInput(inputText)
  // the completion affordance is entirely a function of the server-confirmed status
  const offer = completionOffer(job?.status)

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

      {/* the buyer's task ends where the delivery happened: attest the Submitted
          job here, with the full list and its reject action one link away */}
      {job && (
        <div className="mt-3 rounded-[8px] border hairline border-slate-verdant/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="micro text-newsprint-gray">ERC-8183 job {job.status}</span>
            {offer !== 'none' && (
              <Link
                to="/ongoing"
                className="micro text-newsprint-gray transition hover:text-press-black"
              >
                All your hires
              </Link>
            )}
          </div>
          {offer === 'complete' && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-newsprint-gray">
                Your deliverable is recorded and the job is Submitted. Attest it complete
                to close this hire.
              </p>
              <button
                type="button"
                onClick={completeJob}
                disabled={completing}
                className="micro mt-3 w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              >
                {completing ? 'Signing…' : 'Complete job'}
              </button>
            </>
          )}
          {offer === 'refund' && (
            <p className="mt-2 text-[11px] leading-relaxed text-newsprint-gray">
              The job is still Funded, so there is nothing to complete yet. Your hires page
              can reject it. The payment reached the agent when you signed and is not returned.
            </p>
          )}
          {completeNote && (
            <p className="mt-2 text-[11px] leading-relaxed text-highlighter-green">
              {completeNote}
            </p>
          )}
          {completeError && (
            <p className="mt-2 rounded-[8px] border hairline border-press-black/20 bg-bone-white p-2 text-[11px] leading-relaxed text-press-black">
              {completeError}
            </p>
          )}
        </div>
      )}

      {phase === 'idle' && (
        <button
          type="button"
          onClick={loadCapabilities}
          className="micro mt-3 w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-base sm:text-[11px] text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-base sm:text-[11px] leading-relaxed text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              />
              <button
                type="button"
                onClick={run}
                disabled={running}
                className="micro w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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
                className="w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 text-base sm:text-xs leading-relaxed text-press-black placeholder:text-newsprint-gray/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
              />
              {/* some agents read a structured data part instead of prose; this stays
                  collapsed and empty by default so the text-only flow is unchanged */}
              <details open={prefill?.input ? true : undefined} className="rounded-[5px] border hairline border-slate-verdant/40 p-3">
                <summary className="micro cursor-pointer text-newsprint-gray transition hover:text-press-black">
                  Add structured input (JSON)
                </summary>
                <p className="mt-2 text-[10px] leading-relaxed text-newsprint-gray">
                  Some agents read structured fields. Paste one JSON object, for example{' '}
                  {'{"walletAddress":"0x..."}'}, and it is sent alongside your task text.
                </p>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder={'{"walletAddress":"0x..."}'}
                  aria-label="Structured input as JSON"
                  className="mt-2 w-full rounded-[5px] border hairline border-slate-verdant/50 bg-bone-white px-3 py-2 font-mono text-base sm:text-[11px] leading-relaxed text-press-black placeholder:text-newsprint-gray/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
                />
                {!structured.ok && (
                  <p className="mt-2 text-[11px] leading-relaxed text-press-black">
                    {structured.error}
                  </p>
                )}
              </details>
              <button
                type="button"
                onClick={run}
                disabled={running || !taskText.trim() || !structured.ok}
                className="micro w-full rounded-[5px] bg-highlighter-green px-4 py-3 text-on-highlighter shadow transition hover:brightness-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
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

      {!onResult && output && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] border hairline border-slate-verdant/40 bg-bone-white p-3 font-mono text-[11px] leading-relaxed text-press-black">
          {output}
        </pre>
      )}
    </div>
  )
}

function ResultPanel({
  result,
}: {
  result: { output: string | null; job: { id: string; status: JobStatus } | null; task: HireTask | null }
}) {
  const { output, job, task } = result
  return (
    <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="micro text-newsprint-gray">Result</h2>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-newsprint-gray">
          {task && <span>task {task.status}</span>}
          {task?.quality && (
            <span>
              quality {task.quality.grade} ({task.quality.score})
            </span>
          )}
          {job && <span>job {job.status}</span>}
        </div>
      </div>
      {output ? (
        <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[10px] border hairline border-slate-verdant/40 bg-bone-white p-4 font-mono text-xs leading-relaxed text-press-black">
          {output}
        </pre>
      ) : (
        <p className="mt-4 text-sm text-newsprint-gray">No deliverable yet.</p>
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

// the scan records what the agent's own endpoint returned; published verbatim, no math

function PerformanceSection({ probe }: { probe: PerformanceProbe }) {
  const raw = probe.rawOutput ?? ''
  const truncated = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw

  return (
    <div className="mt-6 rounded-[14px] border hairline border-slate-verdant/40 p-8">
      <h2 className="micro text-newsprint-gray">Self-reported performance</h2>
      <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
        Self-reported by the agent&apos;s own endpoint. Not verified by Agent Souk.
        {probe.scannedAt ? (
          <>
            {' '}
            Captured {timeAgo(probe.scannedAt)}, when the agent returned this.
          </>
        ) : (
          ' Capture date unknown, so treat it as undated.'
        )}
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

function BigMetric({ label, value, accent, note }: { label: string; value: string; accent?: boolean; note?: string }) {
  return (
    <div>
      <div className="micro text-newsprint-gray">{label}</div>
      <div className={`mt-2 truncate font-serif text-[28px] leading-none ${accent ? 'text-highlighter-green' : 'text-press-black'}`}>
        {value}
      </div>
      {note ? <div className="micro mt-2 text-newsprint-gray">{note}</div> : null}
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

function EndpointPanel({ detail }: { detail: DetailWithSession }) {
  const rows: { label: string; value: string; callable: boolean }[] = []
  if (detail.a2a_endpoint) rows.push({ label: 'A2A', value: detail.a2a_endpoint, callable: true })
  if (detail.mcp_server) rows.push({ label: 'MCP', value: detail.mcp_server, callable: true })
  if (detail.web_endpoint) {
    rows.push({ label: 'Web (browser-invoked)', value: detail.web_endpoint, callable: false })
  }
  if (detail.agent_url) rows.push({ label: 'Agent URL', value: detail.agent_url, callable: false })
  if (detail.endpoint_verified_domain) {
    rows.push({ label: 'Verified domain', value: detail.endpoint_verified_domain, callable: false })
  }

  const web = detail.web_endpoint ?? null
  const callable = rows.filter((r) => r.callable)

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
        This agent publishes no endpoint at all, so a hire cannot reach it. Treat the listing as
        reference only.
      </p>
    )
  }

  return (
    <>
      <p className="mt-4 text-sm leading-relaxed text-newsprint-gray">
        {callable.length === 0
          ? 'The marketplace cannot call this agent.'
          : callable.length === 1
            ? 'Invoked over the one endpoint the marketplace can call.'
            : `Invoked over the ${callable.length} endpoints the marketplace can call.`}
      </p>

      {/* a web-only listing is real, but there is nothing a hire can reach */}
      {web && callable.length === 0 && (
        <div className="mt-4 rounded-[10px] border hairline border-press-black/30 bg-bone-white p-4 text-sm leading-relaxed text-press-black">
          <p className="micro">Invoked from a browser page</p>
          <p className="mt-1">
            Its tools live in a browser page, so the marketplace cannot call it. A hire can be
            recorded, but nothing can be delivered to it automatically.
          </p>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="micro text-newsprint-gray">{r.label}</span>
            <a
              href={r.value.startsWith('http') ? r.value : undefined}
              target={r.value.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="max-w-[220px] truncate font-mono text-[11px] text-press-black hover:text-highlighter-green"
            >
              {r.value}
            </a>
          </div>
        ))}
      </div>
    </>
  )
}
