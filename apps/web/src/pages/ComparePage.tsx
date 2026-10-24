import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { AgentDetail, AgentSummary } from '../core/types'
import {
  CATEGORIES,
  JOB_SELLER_NOTE,
  formatNumber,
  formatScore,
  isJobStepSkill,
  sellsByJob,
  takesJobs,
  shortAddress,
  timeAgo,
} from '@agora/core'
import { getAgentDetail, getAgents, getVaultExecutor } from '../lib/api'
import { bestByCategory } from '../lib/compare'
import { getShortlist, setShortlist as persistShortlist } from '../lib/shortlist'
import { ensureBscChain } from '../lib/wallet'
import { connectWallet } from '../lib/wallet-session'
import { hireErrorText, runHire } from '../lib/hire'
import { OPERATED_BY_LABEL, OPERATED_BY_TITLE, isOperatedByAgentSouk } from '../lib/first-party'
import { builtWithFrom } from '../lib/onchain-meta'
import { verdictFor, type VerdictTone } from '../lib/verdict'
import { chainLabel } from '../lib/contracts'
import {
  AgentAvatar,
  Btn,
  Dot,
  IconTrophy,
  Pill,
  Row,
  SectionHead,
  Stack,
  Txt,
  type DotTone,
} from '../components/souk'

const VERDICT_TONE: Record<VerdictTone, DotTone> = {
  good: 'good',
  held: 'held',
  bad: 'bad',
  none: 'quiet',
}

const MAX_COMPARE = 5

function utcStamp(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ]
  return `${time} · ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`
}

function categoryLabelFor(a: AgentDetail): string {
  if (!a.category) return 'General'
  return CATEGORIES.find((c) => c.key === a.category)?.label ?? a.category
}

// the rails an agent actually answers on, read off its record for the head chips
function railsFor(a: AgentDetail): string[] {
  const rails: string[] = []
  if (a.a2a_endpoint || a.agent_url) rails.push('a2a')
  if (a.x402_supported) rails.push('x402')
  if (sellsByJob(a.skills) || takesJobs(a.skills)) rails.push('erc-8183')
  return rails
}

export function ComparePage() {
  const [sp, setSp] = useSearchParams()
  const urlIds = useMemo(
    () =>
      (sp.get('ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [sp],
  )

  const [shortlistIds, setShortlistIds] = useState<string[]>(() => getShortlist())
  const selectedIds = urlIds.length > 0 ? urlIds : shortlistIds
  const selectedKey = selectedIds.join(',')

  function applySelection(next: string[]) {
    const capped = next.slice(0, MAX_COMPARE)
    setShortlistIds(capped)
    persistShortlist(capped)
    const nextSp = new URLSearchParams()
    if (capped.length > 0) nextSp.set('ids', capped.join(','))
    setSp(nextSp, { replace: true })
  }

  function toggleId(id: string) {
    if (selectedIds.includes(id)) {
      applySelection(selectedIds.filter((x) => x !== id))
      return
    }
    if (selectedIds.length >= MAX_COMPARE) return
    applySelection([...selectedIds, id])
  }

  function clearSelection() {
    applySelection([])
  }

  const [agents, setAgents] = useState<AgentDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (selectedIds.length === 0) {
      setAgents([])
      setLoading(false)
      setError(false)
      return
    }
    setLoading(true)
    setError(false)
    const fetchKey = (id: string) => {
      const [chainId = '56', tokenId = id] = id.split('/')
      return getAgentDetail(chainId, tokenId)
    }
    Promise.all(selectedIds.map(fetchKey))
      .then((ds) => {
        if (!cancelled) setAgents(ds.filter((d): d is AgentDetail => d !== null))
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
    // selectedKey is the stable identity of the ordered selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const newestCheck = useMemo(
    () =>
      agents
        .map((a) => a.verification?.checkedAt)
        .filter((t): t is string => Boolean(t))
        .sort()
        .at(-1) ?? null,
    [agents],
  )
  const strapParts = ['compare', `${selectedIds.length} selected`]
  if (newestCheck) {
    const stamp = utcStamp(newestCheck)
    if (stamp) strapParts.push(`read ${stamp}`)
  }

  return (
    <section className="min-h-screen bg-souk-canvas text-souk-ink">
      <div className="pb-[240px] xl:pb-24">
        <Stack gap={10} pad={[32, 0, 0, 0]}>
          <Txt size={11} lead={16} mono upper tone="data">
            {strapParts.join(' · ')}
          </Txt>
          <div className="min-w-0">
            <Txt size={34} lead={42} display weight="bold" tone="ink">
              Side by side.
            </Txt>
          </div>
        </Stack>

        {selectedIds.length === 0 ? (
          <Picker selected={selectedIds} onToggle={toggleId} onClear={clearSelection} />
        ) : (
          <>
            <SelectionTray
              ids={selectedIds}
              agents={agents}
              onRemove={toggleId}
              onClear={clearSelection}
            />
            <div className="mt-5 max-w-[560px]">
              <ShortlistSearch selected={selectedIds} onToggle={toggleId} />
            </div>

            {loading ? (
              <div className="mt-8 animate-pulse space-y-3" role="status" aria-label="Loading comparison">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-14 bg-souk-surface2" />
                ))}
              </div>
            ) : error ? (
              <CompareEmpty failed onPickAgain={clearSelection} />
            ) : agents.length === 0 ? (
              <CompareEmpty failed={false} onPickAgain={clearSelection} />
            ) : (
              <CompareTable agents={agents} onRemove={toggleId} />
            )}
          </>
        )}
      </div>
    </section>
  )
}

function SelectionTray({
  ids,
  agents,
  onRemove,
  onClear,
}: {
  ids: string[]
  agents: AgentDetail[]
  onRemove: (id: string) => void
  onClear: () => void
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-souk-hair py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Txt size={10} lead={14} mono upper tone="labels" className="mr-1 shrink-0">
          {ids.length} / {MAX_COMPARE} selected
        </Txt>
        {ids.map((id) => {
          const agent = agents.find((a) => `${a.chain_id}/${a.token_id}` === id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => onRemove(id)}
              aria-label={`Remove ${agent?.name ?? id} from comparison`}
              className="inline-flex h-7 max-w-[210px] items-center gap-2 rounded-none border border-souk-hair bg-souk-surface1 px-2.5 text-[11px] leading-[15px] text-souk-slate transition hover:border-souk-data/40 hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
            >
              <span className="truncate">{agent?.name ?? id}</span>
              <span aria-hidden="true" className="font-mono text-[13px] leading-none text-souk-muted">
                ×
              </span>
            </button>
          )
        })}
      </div>
      {ids.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="micro shrink-0 text-souk-muted transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
        >
          Clear all
        </button>
      ) : null}
    </div>
  )
}

function Picker({
  selected,
  onToggle,
  onClear,
}: {
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [category, setCategory] = useState<string>('all')
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAgents({ category, q, limit: 24 })
      .then((r) => {
        if (!cancelled) setOptions(r.items)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category, q])

  const keyFor = (a: AgentSummary) => `${a.chain_id}/${a.token_id}`

  return (
    <div className="mt-6">
      <Row align="center" gap={14} className="flex-wrap">
        <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c.key} active={category === c.key} onClick={() => setCategory(c.key)}>
            {c.label}
          </FilterChip>
        ))}
        <Row
          align="center"
          gap={12}
          hair
          pad={[0, 6, 0, 18]}
          className="h-11 w-full max-w-[420px] sm:w-96"
        >
          <label className="sr-only" htmlFor="compare-search">
            Search agents
          </label>
          <input
            id="compare-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, endpoint or tag"
            className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
          />
        </Row>
      </Row>

      <Row align="center" gap={16} className="mt-3">
        <Txt size={11} lead={16} mono tone={selected.length > 0 ? 'data' : 'muted'}>
          {selected.length > 0 ? `${selected.length} selected` : 'Pick two or more agents to compare'}
        </Txt>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-bold uppercase text-souk-steel transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
          >
            Clear
          </button>
        ) : null}
      </Row>

      {loading ? (
        <div className="mt-6 animate-pulse space-y-2" role="status" aria-label="Loading candidates">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 bg-souk-surface2" />
          ))}
        </div>
      ) : (
        <div className="mt-6 border-y border-souk-hair">
          {options.map((a) => {
            const key = keyFor(a)
            const checked = selected.includes(key)
            return (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-4 border-b border-souk-hair/60 px-1 py-3 transition last:border-b-0 ${
                  checked ? 'bg-souk-data/5' : 'hover:bg-souk-surface2/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(key)}
                  className="h-4 w-4 accent-souk-data"
                />
                <AgentAvatar
                  size={34}
                  name={a.name}
                  imageUrl={a.image_url}
                  chainId={a.chain_id}
                  tokenId={a.token_id}
                />
                <span className="min-w-0 flex-1">
                  <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">
                    {a.name}
                  </Txt>
                  <Txt size={11} lead={15} mono tone="labels" className="mt-0.5 block">
                    {categoryName(a.category)} ·{' '}
                    {isOperatedByAgentSouk(a.owner_address)
                      ? OPERATED_BY_LABEL
                      : shortAddress(a.owner_address)}
                  </Txt>
                </span>
                <VerdictInline agent={a} />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompareTable({
  agents,
  onRemove,
}: {
  agents: AgentDetail[]
  onRemove: (id: string) => void
}) {
  const winnerIds = useMemo(
    () => new Set(Object.values(bestByCategory(agents)).filter((id): id is string => id !== null)),
    [agents],
  )
  const [hiringKey, setHiringKey] = useState<string | null>(null)
  const [vaultWallets, setVaultWallets] = useState<Set<string>>(new Set())

  useEffect(() => {
    getVaultExecutor()
      .then((executor) => {
        if (!executor) return
        setVaultWallets(new Set((executor.executors ?? [executor.address]).map((w) => w.toLowerCase())))
      })
      .catch(() => {})
  }, [])

  const columns = agents.map((agent) => ({
    agent,
    category: categoryLabelFor(agent),
  }))
  const cats = useMemo(() => [...new Set(columns.map((c) => c.category))], [columns])
  const catLabel = cats.length === 1 ? cats[0] : `${cats.length} categories`

  const rows: { label: string; cell: (a: AgentDetail) => ReactNode }[] = [
    {
      label: 'Last check',
      cell: (a) => {
        const v = verdictFor(a.chain_id, a.verification)
        return (
          <span className="block" title={v.explain}>
            <span className="flex items-center gap-2">
              <Dot tone={VERDICT_TONE[v.tone]} size={8} />
              <Txt size={13} lead={19} weight="semibold" tone="slate">
                {v.label}
              </Txt>
            </span>
            {a.verification ? (
              <Txt size={11} lead={15} tone="muted" className="mt-0.5 block">
                checked {timeAgo(a.verification.checkedAt)}
              </Txt>
            ) : null}
          </span>
        )
      },
    },
    {
      label: 'How you pay',
      cell: (a) => {
        const vault = Boolean(a.agent_wallet && vaultWallets.has(a.agent_wallet.toLowerCase()))
        if (vault) return 'Vault hire'
        return sellsByJob(a.skills)
          ? 'By ERC-8183 job'
          : takesJobs(a.skills)
            ? 'Per call, x402, or ERC-8183 job'
            : 'Per call, x402'
      },
    },
    {
      label: 'What it does',
      cell: (a) => {
        const names = (a.skills ?? [])
          .filter((s) => !isJobStepSkill(s, a.skills ?? []))
          .map((s) => s.name ?? s.id)
          .filter((n): n is string => Boolean(n))
        if (names.length === 0)
          return (
            <Txt size={13} lead={19} tone="muted">
              {a.description?.slice(0, 110) || 'No skill list'}
            </Txt>
          )
        return (
          <span className="block space-y-0.5">
            {names.slice(0, 3).map((n) => (
              <Txt key={n} size={13} lead={19} tone="slate" className="block">
                {n}
              </Txt>
            ))}
            {names.length > 3 ? (
              <Txt size={13} lead={19} tone="muted" className="block">
                and {names.length - 3} more
              </Txt>
            ) : null}
          </span>
        )
      },
    },
    {
      label: 'Registry score',
      cell: (a) => (
        <Txt size={16} lead={22} mono tone="data">
          {formatScore(a.total_score)}
        </Txt>
      ),
    },
    {
      label: 'Reviews',
      cell: (a) => (
        <Txt size={14} lead={20} mono tone={a.total_feedbacks === 0 ? 'steel' : 'data'}>
          {formatNumber(a.total_feedbacks)}
        </Txt>
      ),
    },
    {
      label: 'Health',
      cell: (a) => (
        <Txt size={14} lead={20} mono tone="ink">
          {a.health_score !== null ? formatScore(a.health_score) : 'n/a'}
        </Txt>
      ),
    },
    {
      label: 'Built with',
      cell: (a) => {
        const b = builtWithFrom(a.raw_metadata?.onchain ?? [])
        return b ? (
          <Txt size={13} lead={19} tone="slate">
            {b.label}
          </Txt>
        ) : (
          <Txt size={13} lead={19} tone="muted">
            Not stated
          </Txt>
        )
      },
    },
    {
      label: 'Owner',
      cell: (a) =>
        isOperatedByAgentSouk(a.owner_address) ? (
          <Txt size={13} lead={19} tone="slate" className="block">
            <span title={OPERATED_BY_TITLE}>{OPERATED_BY_LABEL}</span>
          </Txt>
        ) : (
          <Txt size={12} lead={18} mono tone="slate" className="block">
            {shortAddress(a.owner_address)}
          </Txt>
        ),
    },
  ]

  return (
    <div id="compare-table" className="mt-8 scroll-mt-8">
      <Row align="center" gap={10} className="mb-3">
        <Txt size={11} lead={16} weight="bold" upper tone="data">
          {catLabel}
        </Txt>
        <Txt size={11} lead={16} tone="muted">
          {agents.length} agents
        </Txt>
        {agents.length === 1 ? (
          <Txt size={11} lead={16} tone="peach">
            Add one more to make it a comparison
          </Txt>
        ) : null}
      </Row>

      <div className="overflow-x-auto border border-souk-hair">
        <table
          className="w-full border-collapse text-left"
          style={{
            tableLayout: 'fixed',
            minWidth: 260 + columns.length * 220,
          }}
        >
          <colgroup>
            <col style={{ width: 260 }} />
            {columns.map(({ agent }) => (
              <col key={agent.agent_id} style={{ width: `calc((100% - 260px) / ${columns.length})` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 border-b border-r border-souk-hair bg-souk-surface1 text-left"
                style={{ padding: '14px 12px' }}
              >
                <Txt size={11} lead={16} weight="bold" upper tone="steel">
                  Fact
                </Txt>
              </th>
              {columns.map(({ agent: a, category }) => {
                const best = winnerIds.has(a.agent_id)
                return (
                  <th
                    key={a.agent_id}
                    scope="col"
                    className="border-b border-r border-souk-hair bg-souk-surface1 text-left font-normal last:border-r-0"
                    style={{ padding: '14px 12px' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Row align="center" gap={10} className="min-w-0">
                        <AgentAvatar
                          size={34}
                          name={a.name}
                          imageUrl={a.image_url}
                          chainId={a.chain_id}
                          tokenId={a.token_id}
                        />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Link
                              to={`/agents/${a.chain_id}/${a.token_id}`}
                              className="truncate text-[15px] font-bold leading-[21px] text-souk-ink transition hover:text-souk-data focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                            >
                              {a.name}
                            </Link>
                            {best ? (
                              <span
                                title={`Best in ${category.toLowerCase()} per the shelf's order: last check, then registry score, then reviews`}
                              >
                                <IconTrophy />
                              </span>
                            ) : null}
                          </span>
                          <Txt size={10} lead={14} mono tone="labels" className="block">
                            {chainLabel(a.chain_id)} / #{a.token_id}
                          </Txt>
                        </span>
                      </Row>
                      <button
                        type="button"
                        onClick={() => onRemove(`${a.chain_id}/${a.token_id}`)}
                        aria-label={`Remove ${a.name} from comparison`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none border border-souk-hair text-[13px] leading-none text-souk-muted transition hover:border-souk-peach/40 hover:text-souk-peach focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Pill variant="off">{category}</Pill>
                      {railsFor(a).map((rail) => (
                        <Pill key={rail} variant="off">
                          {rail}
                        </Pill>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {sellsByJob(a.skills) ? (
                        <span title={JOB_SELLER_NOTE}>
                          <Txt size={11} lead={16} tone="steel">
                            Job only
                          </Txt>
                        </span>
                      ) : (
                        <CompareHireButton
                          agent={a}
                          disabled={Boolean(hiringKey && hiringKey !== a.agent_id)}
                          onStart={() => setHiringKey(a.agent_id)}
                          onDone={() => setHiringKey(null)}
                        />
                      )}
                      <Link
                        to={`/agents/${a.chain_id}/${a.token_id}`}
                        className="text-[11px] leading-[16px] text-souk-steel underline decoration-souk-hair underline-offset-4 transition hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
                      >
                        Open agent
                      </Link>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-r border-souk-edge bg-souk-surface1 text-left align-middle last:border-b-0"
                  style={{ padding: '8px 12px' }}
                >
                  <Txt size={11} lead={16} weight="bold" upper tone="steel">
                    {r.label}
                  </Txt>
                </th>
                {columns.map(({ agent: a }) => (
                  <td
                    key={a.agent_id}
                    className="border-b border-r border-souk-edge align-middle text-souk-ink last:border-r-0"
                    style={{ padding: '8px 12px' }}
                  >
                    {r.cell(a)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CompareHireButton({
  agent,
  disabled,
  onStart,
  onDone,
}: {
  agent: AgentDetail
  disabled?: boolean
  onStart: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'terms' | 'signing' | 'settling' | 'hired' | 'failed'>('idle')
  const [error, setError] = useState('')

  const busy =
    phase === 'connecting' || phase === 'terms' || phase === 'signing' || phase === 'settling'

  async function start() {
    if (busy || phase === 'hired' || disabled) return
    setError('')
    setPhase('connecting')
    onStart()
    try {
      const address = await connectWallet()
      await ensureBscChain()
      setPhase('terms')
      const outcome = await runHire(
        {
          chainId: Number(agent.chain_id),
          tokenId: Number(agent.token_id),
          name: agent.name,
        },
        { address },
        (s) => {
          if (s.phase === 'requirements') setPhase('terms')
          else if (s.phase === 'signing') setPhase('signing')
          else if (s.phase === 'settling') setPhase('settling')
        },
      )
      if (outcome.success) {
        setPhase('hired')
      } else if (outcome.cancelled) {
        setPhase('idle')
        setError('Signature cancelled.')
      } else {
        setPhase('failed')
        setError(outcome.error ?? 'Hire failed.')
      }
    } catch (e) {
      setPhase('failed')
      setError(hireErrorText(e))
    } finally {
      onDone()
    }
  }

  const label =
    phase === 'connecting'
      ? 'Connecting...'
      : phase === 'terms'
        ? 'Reading terms...'
        : phase === 'signing'
          ? 'Sign in wallet...'
          : phase === 'settling'
            ? 'Settling...'
            : phase === 'hired'
              ? 'Hired'
              : phase === 'failed'
                ? 'Retry hire'
                : 'Hire'

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => void start()}
        disabled={Boolean(disabled || busy || phase === 'hired')}
        className="inline-flex h-8 items-center justify-center rounded-none bg-souk-data px-3 text-[11px] font-semibold leading-none text-souk-canvas transition hover:bg-souk-data/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data disabled:cursor-not-allowed disabled:opacity-40"
      >
        {label}
      </button>
      {phase === 'hired' ? (
        <Link
          to="/ongoing"
          className="ml-2 text-[10px] leading-[14px] text-souk-data underline decoration-souk-data/40 underline-offset-4 transition hover:text-souk-ink"
        >
          Open ledger
        </Link>
      ) : null}
      {error ? (
        <Txt size={10} lead={14} tone="peach" className="mt-1 block">
          {error}
        </Txt>
      ) : null}
    </div>
  )
}

function CompareEmpty({ failed, onPickAgain }: { failed: boolean; onPickAgain: () => void }) {
  return (
    <Stack gap={12} className="mt-8 border-t border-souk-hair pt-6">
      <Stack hair gap={12} pad={[32, 16, 32, 16]} className="items-center text-center">
        <Txt size={24} lead={30} mono tone="steel">
          0 agents
        </Txt>
        <Txt size={13} lead={20} tone="steel" className="block max-w-[560px]">
          {failed
            ? 'Could not load those agents. Pick them again.'
            : 'None of those agents could be loaded. They may have left the registry.'}
        </Txt>
        <Btn kind="off" onClick={onPickAgain}>
          Pick them again
        </Btn>
      </Stack>
    </Stack>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
    >
      <Pill variant={active ? 'keep' : 'off'}>{children}</Pill>
    </button>
  )
}

function ShortlistSearch({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    getAgents({ q, limit: 6 })
      .then((r) => {
        if (!cancelled) setResults(r.items)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q])

  return (
    <div>
      <SectionHead title="Add another agent" />
      <Row align="center" gap={12} hair pad={[0, 6, 0, 18]} className="mt-3 h-11 w-full">
        <label className="sr-only" htmlFor="compare-add-search">
          Add another agent
        </label>
        <input
          id="compare-add-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, endpoint or tag"
          className="w-full bg-transparent text-[13px] leading-5 text-souk-ink placeholder:text-souk-muted focus-visible:outline-none"
        />
      </Row>

      {q.trim() ? (
        loading ? (
          <div className="mt-3 animate-pulse space-y-2" role="status" aria-label="Loading search results">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-10 bg-souk-surface2" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Txt size={13} lead={18} tone="muted" className="mt-3 block px-1">
            Nothing matches that search.
          </Txt>
        ) : (
          <Stack hair className="mt-3 overflow-hidden">
            {results.map((a) => {
              const key = `${a.chain_id}/${a.token_id}`
              const checked = selected.includes(key)
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-4 border-b border-souk-edge px-4 py-2.5 transition last:border-b-0 focus-within:bg-souk-data/10 ${
                    checked ? 'bg-souk-data/10' : 'hover:bg-souk-surface2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(key)}
                    aria-label={`Compare ${a.name}`}
                    className="h-3.5 w-3.5 accent-souk-data"
                  />
                  <AgentAvatar
                    size={28}
                    name={a.name}
                    imageUrl={a.image_url}
                    chainId={a.chain_id}
                    tokenId={a.token_id}
                  />
                  <Txt size={14} lead={20} weight="semibold" tone="ink" className="min-w-0 flex-1 block truncate">
                    {a.name}
                  </Txt>
                  <VerdictInline agent={a} />
                </label>
              )
            })}
          </Stack>
        )
      ) : null}
    </div>
  )
}

function VerdictInline({ agent }: { agent: AgentSummary }) {
  const v = verdictFor(agent.chain_id, agent.verification)
  return (
    <span
      className="flex shrink-0 items-center gap-2 text-[13px] leading-[19px] text-souk-slate"
      title={v.explain}
    >
      <Dot tone={VERDICT_TONE[v.tone]} size={8} />
      {v.label}
    </span>
  )
}

function categoryName(key: AgentSummary['category']): string {
  if (!key || key === 'general') return 'General'
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}
