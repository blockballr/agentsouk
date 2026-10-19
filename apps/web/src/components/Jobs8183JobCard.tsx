import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Jobs8183Row } from '../lib/api'
import { jobStatusName } from '../lib/jobs8183'
import { Btn, Pill, Row, Stack, Txt } from './souk'

const STEPS = ['Funded', 'Submitted', 'Settled'] as const
const PREVIEW_CHARS = 700

function stopFor(status: number | null): number {
  if (status === 3) return 2
  if (status === 2) return 1
  if (status === 1) return 0
  return -1
}

function statusVariant(status: number | null): 'keep' | 'warn' | 'off' {
  if (status === 1 || status === 2 || status === 3) return 'keep'
  if (status === 4) return 'warn'
  return 'off'
}

function statusNote(job: Jobs8183Row): string {
  switch (job.status) {
    case 1:
      return new Date(job.expiredAt).getTime() <= Date.now()
        ? 'The funded job is past its deadline and no deliverable was submitted. The buyer can reclaim the escrow.'
        : 'The escrow is funded. The seller has not submitted a deliverable yet.'
    case 2:
      return 'The seller submitted a deliverable. The result is below; settlement follows the dispute window.'
    case 3:
      return 'The job is complete. The result is below and the escrow has been released.'
    case 4:
      return 'The job was rejected. No deliverable was accepted, so there is no result to show.'
    case 5:
      return 'The job expired before a deliverable was accepted. The buyer can reclaim the escrow.'
    default:
      return 'The kernel did not answer for this row. Refresh in a moment.'
  }
}

// One ERC-8183 job, read from the chain and the deliverable store. The same
// card sits in the ongoing ledger and on the agent page, so a funded job never
// reads as a blank fund form when the buyer comes back to it.
export default function Jobs8183JobCard({
  job,
  surface = true,
  onFundNew,
}: {
  job: Jobs8183Row
  // an AsideCard on the agent page already supplies the shell
  surface?: boolean
  onFundNew?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const content = job.result?.content ?? null
  const at = stopFor(job.status)
  const preview = content && content.length > PREVIEW_CHARS && !expanded
    ? `${content.slice(0, PREVIEW_CHARS).trimEnd()}...`
    : content
  const resultPending = (job.status === 2 || job.status === 3) && !content
  const agentHref = `/agents/${job.chainId}/${job.tokenId}?job=${job.onchainJobId}`

  return (
    <Stack surface={surface} pad={[16, 16, 16, 16]} gap={12}>
      <Row justify="between" align="baseline" gap={12}>
        <Link to={agentHref} className="min-w-0">
          <Txt size={15} lead={20} weight="bold" tone="ink" className="block truncate">
            {job.agentName}
          </Txt>
        </Link>
        <Txt size={13} lead={20} mono tone="data">
          {job.budgetUsd} $U
        </Txt>
      </Row>

      <Row justify="between" align="center" gap={12}>
        <Txt size={12} lead={18} mono tone="muted">
          {new Date(job.expiredAt).toLocaleDateString()}
        </Txt>
        <Pill variant={statusVariant(job.status)}>
          {job.status === null ? 'unreached' : jobStatusName(job.status)}
        </Pill>
      </Row>

      {at >= 0 ? (
        <Stack gap={8}>
          <Row align="center" gap={0}>
            {STEPS.map((step, i) => (
              <div key={step} className="flex flex-1 items-center">
                <span
                  className={`flex h-[10px] w-[10px] shrink-0 rounded-full ${
                    i === at
                      ? 'bg-souk-data ring-2 ring-souk-sky/85'
                      : i < at
                        ? 'bg-souk-data'
                        : 'border border-souk-steel/50'
                  }`}
                />
                {i < STEPS.length - 1 ? <span className="h-px flex-1 bg-souk-hair" /> : null}
              </div>
            ))}
          </Row>
          <Row align="center" gap={0}>
            {STEPS.map((step, i) => (
              <span
                key={step}
                className={`flex-1 text-center font-mono text-[11px] uppercase leading-[16px] ${
                  i <= at ? 'font-bold text-souk-ink' : 'font-semibold text-souk-muted'
                }`}
              >
                {step}
              </span>
            ))}
          </Row>
        </Stack>
      ) : null}

      <Txt size={13} lead={20} tone="slate">
        {statusNote(job)}
      </Txt>

      {content && preview ? (
        <Stack gap={6}>
          <Row justify="between" align="center" gap={12}>
            <Txt size={10} lead={16} weight="bold" upper tone="muted">
              Result
            </Txt>
            {content.length > PREVIEW_CHARS ? (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                className="micro text-souk-slate underline transition hover:text-souk-ink"
              >
                {expanded ? 'Collapse' : 'View full result'}
              </button>
            ) : null}
          </Row>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-souk-edge bg-souk-surface2 p-3 font-mono text-[11px] leading-[17px] text-souk-slate">
            {preview}
          </pre>
          {job.result?.url ? (
            <a
              href={job.result.url}
              target="_blank"
              rel="noreferrer"
              className="micro text-souk-slate underline transition hover:text-souk-ink"
            >
              Open the seller's source
            </a>
          ) : null}
        </Stack>
      ) : resultPending ? (
        <Txt size={12} lead={18} tone="muted">
          The seller submitted a deliverable, but its text is not available here yet.{' '}
          {job.result?.url ? (
            <a href={job.result.url} target="_blank" rel="noreferrer" className="underline">
              Open it
            </a>
          ) : (
            'Refresh in a moment.'
          )}
        </Txt>
      ) : job.status === 1 ? (
        <Txt size={12} lead={18} tone="muted">
          No result yet. The seller has not submitted a deliverable.
        </Txt>
      ) : null}

      <Row justify="between" align="center" gap={12} className="flex-wrap">
        <Txt size={12} lead={18} tone="muted">
          kernel job{' '}
          <Txt size={12} lead={18} mono tone="slate">
            {job.onchainJobId}
          </Txt>
        </Txt>
        <Row align="center" gap={12}>
          <Link to="/ongoing" className="micro text-souk-slate underline transition hover:text-souk-ink">
            Open in ongoing
          </Link>
          {onFundNew ? (
            <Btn kind="off" onClick={onFundNew}>
              Fund a new job
            </Btn>
          ) : null}
        </Row>
      </Row>
    </Stack>
  )
}
