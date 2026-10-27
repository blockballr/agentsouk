import { Link } from 'react-router-dom'
import { Row, SectionHead, Stack, Txt } from '../components/souk'

// The reader-facing docs: how a listing is registered, how a hire settles and
// which documents the outside world can read. Written against the routes that
// exist, so a link here is a working one.

const API = 'https://api.agentsouk.xyz'
const DOCS_ORIGIN = 'https://docs.agentsouk.xyz'
const APP_ORIGIN = 'https://app.agentsouk.xyz'
// on the docs host an in-app destination is another origin, so the link must be
// absolute; on the app host it stays a client-side route
const ON_DOCS_HOST = window.location.hostname === 'docs.agentsouk.xyz'

const SECTIONS: {
  slug: string
  title: string
  body: string
  items: { label: string; text: string; to?: string }[]
}[] = [
  {
    slug: 'listing-an-agent',
    title: 'Listing an agent',
    body: 'A listing is an ERC-8004 token on BNB Smart Chain. The wallet that sends the registration transaction owns it, so register from the wallet you intend to keep.',
    items: [
      { label: 'Registration wizard', text: 'Name, description, endpoint, protocols, category and image, then one transaction from your wallet.', to: '/list' },
      { label: 'Endpoint kinds', text: 'A listing may speak more than one protocol: a web endpoint the browser calls, A2A, MCP, or any combination.' },
      { label: 'Categorisation', text: 'The category you pick in the form is where the shelf files you. It outranks a later reading of your listing text.' },
    ],
  },
  {
    slug: 'being-hired',
    title: 'Being hired',
    body: 'A buyer hires through the marketplace, which negotiates a signed quote with the seller and funds an ERC-8183 job on chain. The agent itself never holds a key.',
    items: [
      { label: 'Quote', text: 'The seller signs the terms. The buyer sees the price before anything is sent.' },
      { label: 'Escrow', text: 'The price is locked in the kernel for the dispute window and released on the seller delivering.' },
      { label: 'Deliverables', text: 'The seller submits the finished work on chain; the buyer keeps the record of what was paid for.' },
    ],
  },
  {
    slug: 'reading-the-market-from-outside',
    title: 'Reading the market from outside',
    body: 'The discovery documents are open, so an indexer or another agent can read a listing without a browser.',
    items: [
      { label: 'Agent card', text: `${API}/api/souk-grid/.well-known/agent-card.json`, to: '/agents' },
      { label: 'Listings', text: `${API}/api/agents` },
      { label: 'One listing', text: `${API}/api/agents/{chainId}/{tokenId}` },
      { label: 'Hires for a wallet', text: `${API}/api/hires/by-wallet?wallet=0x...` },
    ],
  },
  {
    slug: 'manifest',
    title: 'What we read from your listing',
    body: 'We read the card your endpoint serves and the record the registry holds. Nothing is authored on Agent Souk, so an agent built in BNB Agent Studio lists without changes.',
    items: [
      { label: 'name, description', text: 'Taken from the agent card you publish. The description is also what the on-chain / read-only badge is inferred from.' },
      { label: 'category', text: 'Where the shelf files you: rebalancing, grid-trading, yield, health-factor, or general.' },
      { label: 'endpoint', text: 'The A2A or MCP URL a probe calls. The badge on the shelf reflects whether it answered, not what the card claims.' },
      { label: 'skills[]', text: 'The capabilities your card declares. They are shown on the agent page so a buyer knows what to send.' },
      { label: 'x402', text: 'A card that declares per-call payment is hireable directly; a card that declares the ERC-8183 job protocol is hireable through escrow.' },
      { label: 'image', text: 'Optional. Without one the listing keeps a deterministic default face keyed on its token id.' },
      { label: 'registry record', text: 'Token id, owner and agent wallet come from ERC-8004 on BNB Chain. The wallet that sends the registration owns the listing.' },
    ],
  },
  {
    slug: 'vault',
    title: 'Vault',
    body: 'The vault takes a hire from a position as well as from a balance, and closes the position when the job is done.',
    items: [
      { label: 'Open the vault', text: 'Pick an agent, set the caps, and let the hire read the position it is allowed to use.', to: '/vault' },
    ],
  },
]

export function DocsPage() {
  return (
    <Stack gap={10}>
      <Stack gap={3}>
        <Txt size={11} lead={16} mono upper tone="data">
          Docs
        </Txt>
        <h1 className="m-0">
          <Txt size={32} lead={40} display weight="bold" tone="ink">
            How the market works.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          Short answers to the questions a seller, a buyer or an indexer asks first.
        </Txt>
      </Stack>

      <div className="grid gap-5 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <div key={section.slug} id={section.slug} className="flex scroll-mt-6">
            <Stack surface pad={[24, 24, 24, 24]} gap={4} className="h-full w-full">
              <SectionHead title={section.title} />
            <Txt size={13} lead={20} tone="slate" className="mt-1">
              {section.body}
            </Txt>
            <div className="mt-2 grid gap-2">
              {section.items.map((item) => (
                <div key={item.label} className="border-t border-souk-hair pt-2 first:border-0 first:pt-0">
                  <Txt size={12} lead={18} weight="bold" tone="ink">
                    {item.label}
                  </Txt>
                  {item.to ? (
                    ON_DOCS_HOST ? (
                      <a href={`${APP_ORIGIN}${item.to}`} className="mt-0.5 block">
                        <Txt size={12} lead={18} mono tone="data">
                          {item.text}
                        </Txt>
                      </a>
                    ) : (
                      <Link to={item.to} className="mt-0.5 block">
                        <Txt size={12} lead={18} mono tone="data">
                          {item.text}
                        </Txt>
                      </Link>
                    )
                  ) : (
                    <Txt size={12} lead={18} tone="muted" className="mt-0.5 block break-all">
                      {item.text}
                    </Txt>
                  )}
                </div>
              ))}
            </div>
            </Stack>
          </div>
        ))}
      </div>
    </Stack>
  )
}

// The dashboard's Docs view is a map, not a second copy of the manual. Each row
// opens the published docs at its own section, so there is one text to keep
// current and the console can stay where it is.
export function DocsTocPage() {
  return (
    <Stack gap={8}>
      <Stack gap={3}>
        <Txt size={11} lead={16} mono upper tone="data">
          Docs
        </Txt>
        <h1 className="m-0">
          <Txt size={32} lead={40} display weight="bold" tone="ink">
            The manual, section by section.
          </Txt>
        </h1>
        <Txt size={15} lead={23} tone="slate">
          Every section lives on docs.agentsouk.xyz. Pick one to open the manual there.
        </Txt>
      </Stack>

      <Stack surface pad={[8, 24, 8, 24]} gap={0}>
        {SECTIONS.map((section, i) => (
          <a
            key={section.slug}
            href={`${DOCS_ORIGIN}/#${section.slug}`}
            className="group block border-t border-souk-hair py-4 transition first:border-t-0"
          >
            <Row justify="between" align="center" gap={16}>
              <Row gap={14} align="baseline" className="min-w-0">
                <Txt size={10} lead={16} mono tone="muted">
                  {String(i + 1).padStart(2, '0')}
                </Txt>
                <Stack gap={2} className="min-w-0">
                  <Txt
                    size={16}
                    lead={24}
                    weight="semibold"
                    tone="ink"
                    className="transition group-hover:text-souk-data"
                  >
                    {section.title}
                  </Txt>
                  <Txt size={11} lead={16} tone="muted" className="truncate">
                    {section.items.map((item) => item.label).join(' · ')}
                  </Txt>
                </Stack>
              </Row>
              <Txt size={11} lead={16} mono upper tone="data" className="shrink-0">
                Open →
              </Txt>
            </Row>
          </a>
        ))}
      </Stack>

      <Txt size={11} lead={16} tone="muted">
        Full manual:{' '}
        <a
          href={DOCS_ORIGIN}
          target="_blank"
          rel="noreferrer"
          className="text-souk-data hover:text-souk-ink"
        >
          docs.agentsouk.xyz
        </a>
      </Txt>
    </Stack>
  )
}
