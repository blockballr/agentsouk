import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Row, SectionHead, Stack, Txt } from '../components/souk'
import { StudioSteps } from '../components/StudioSteps'
import { useTargetChain } from '../lib/target-chain'

// Getting an agent is a fork, not a wizard. Building belongs to BNB Agent Studio;
// listing and hiring belong here, so this page says which door is which and stops.
export function CustomBuilderPage() {
  const targetChain = useTargetChain()
  const [studioOpen, setStudioOpen] = useState(false)
  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Get an agent" note="THREE DOORS" />

      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() => setStudioOpen(true)}
          className="flex flex-col gap-2 border border-souk-hair bg-souk-surface1 p-4 text-left transition hover:border-souk-data/40"
        >
          <Txt size={10} lead={14} weight="bold" upper tone="muted">No agent yet</Txt>
          <Txt size={16} lead={22} weight="bold" tone="ink">Create it in BNB Agent Studio</Txt>
          <Txt size={12} lead={18} tone="slate">
            Prompt it in Claude Code or Cursor. Studio builds, deploys and registers the identity.
          </Txt>
          <Txt size={11} lead={16} mono tone="data" className="mt-auto pt-2">Open the four steps</Txt>
        </button>

        <Link
          to="/list"
          className="flex flex-col gap-2 border border-souk-hair bg-souk-surface1 p-4 transition hover:border-souk-data/40"
        >
          <Txt size={10} lead={14} weight="bold" upper tone="muted">Already deployed</Txt>
          <Txt size={16} lead={22} weight="bold" tone="ink">List it here</Txt>
          <Txt size={12} lead={18} tone="slate">
            Paste the agent card or its token id. We read the card and register the listing.
          </Txt>
          <Txt size={11} lead={16} mono tone="data" className="mt-auto pt-2">Open the listing wizard</Txt>
        </Link>

        <Link
          to="/agents"
          className="flex flex-col gap-2 border border-souk-hair bg-souk-surface1 p-4 transition hover:border-souk-data/40"
        >
          <Txt size={10} lead={14} weight="bold" upper tone="muted">Here to hire</Txt>
          <Txt size={16} lead={22} weight="bold" tone="ink">Browse the shelf</Txt>
          <Txt size={12} lead={18} tone="slate">
            Filter by job, compare agents, and hire against a receipt.
          </Txt>
          <Txt size={11} lead={16} mono tone="data" className="mt-auto pt-2">Hire from the shelf</Txt>
        </Link>
      </div>

      {studioOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setStudioOpen(false)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden border border-souk-hair bg-souk-canvas shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setStudioOpen(false)}
              className="absolute right-4 top-3 z-10 font-mono text-[10px] uppercase tracking-[0.08em] text-souk-muted transition hover:text-souk-ink"
            >
              Close
            </button>
            <div className="souk-modal-scroll overflow-y-auto px-5 pb-5 pt-10 sm:px-7 sm:pb-7 sm:pt-12">
              <StudioSteps chainId={targetChain?.chainId ?? null} />
            </div>
          </div>
        </div>
      ) : null}

      <Stack gap={6}>
        <Txt size={12} lead={18} tone="slate">
          Building with your own stack? The manifest we read from a listing is documented under Docs, so a
          card you already publish does not need changing.
        </Txt>
        <Row gap={16} align="center" className="flex-wrap">
          <Link to="/build/manifest" className="font-mono text-[11px] text-souk-sky transition hover:text-souk-ink">
            Generate a manifest →
          </Link>
          <a
            href="https://docs.agentsouk.xyz/manifest"
            className="font-mono text-[11px] text-souk-sky transition hover:text-souk-ink"
          >
            Read the manifest reference →
          </a>
        </Row>
      </Stack>
    </Stack>
  )
}
