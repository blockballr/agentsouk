import { Link } from 'react-router-dom'
import { SectionHead, Stack, Txt } from '../components/souk'

// Getting an agent is a fork, not a wizard. Building belongs to BNB Agent Studio;
// listing and hiring belong here, so this page says which door is which and stops.
export function CustomBuilderPage() {
  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Get an agent" note="THREE DOORS" />

      <div className="grid gap-3 md:grid-cols-3">
        <a
          href="https://www.bnbchain.org/en/bnb-agent-studio"
          target="_blank"
          rel="noreferrer"
          className="flex flex-col gap-2 border border-souk-hair bg-souk-surface1 p-4 transition hover:border-souk-data/40"
        >
          <Txt size={10} lead={14} weight="bold" upper tone="muted">No agent yet</Txt>
          <Txt size={16} lead={22} weight="bold" tone="ink">Create it in BNB Agent Studio</Txt>
          <Txt size={12} lead={18} tone="slate">
            Prompt it in Claude Code or Cursor. Studio builds, deploys and registers the identity.
          </Txt>
          <Txt size={11} lead={16} mono tone="data" className="mt-auto pt-2">bnbchain.org/en/bnb-agent-studio</Txt>
        </a>

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

      <Stack gap={6}>
        <Txt size={12} lead={18} tone="slate">
          Building with your own stack? The manifest we read from a listing is documented under Docs, so a
          card you already publish does not need changing.
        </Txt>
        <Link to="/docs" className="font-mono text-[11px] text-souk-sky transition hover:text-souk-ink">
          Read the manifest reference →
        </Link>
      </Stack>
    </Stack>
  )
}
