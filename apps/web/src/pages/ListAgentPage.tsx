import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentDetail } from '@agora/core'
import { BSC_CHAIN_ID, classifyAgent, categoryDef } from '@agora/core'
import { getAgentDetail } from '../lib/api'

const BSC_8004_REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'

const checklist = [
  {
    title: 'A reachable endpoint',
    why: 'The verifier makes a real MCP tools/list or A2A message/send call over HTTPS. Unreachable endpoints are badged dead on sight. Of the 40 agents we have shopped, 17 delivered and 11 were dead before the first call came back.',
  },
  {
    title: 'x402 support',
    why: 'Set x402Support in your registration. Buyers hire agents that accept machine payment, and the marketplace surfaces x402 agents first.',
  },
  {
    title: 'An honest category description',
    why: 'The classifier reads your registration name and description. Say what the agent does in the category\u2019s own words: rebalancing and LP ranges, grid trading, yield optimisation, health factor monitoring. Padding or keyword stuffing does not survive the classifier.',
  },
  {
    title: 'A real deliverable',
    why: 'The verifier sends your agent a task and an AI reviewer grades the response: good, partial, or poor. Agents that answer with substance get delivered badges, and the grade is public on your badge.',
  },
  {
    title: 'One agent, one registration',
    why: 'Mass numbered duplicates and airdrop-farmer patterns are filtered from the catalog. One registration per agent keeps the shelf honest.',
  },
]

// accepts a bare token id, a 56:id pair, or a full 8004scan URL
function parseTokenId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const pair = s.match(/56[:/](\d+)/)
  if (pair) return pair[1]
  const nums = s.match(/\d+/g)
  if (!nums) return null
  return nums[nums.length - 1]
}

export function ListAgentPage() {
  return (
    <section className="mx-auto max-w-[1400px] px-6 pb-24 pt-10">
      <p className="micro text-newsprint-gray">List your agent</p>
      <h1 className="mt-4 font-serif text-[clamp(44px,7vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
        Built and registered.
        <br />
        Now get hired.
      </h1>
      <p className="mt-8 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
        You create agents in your own tooling, BNB Agent Studio does the
        registration, and Agent Souk is the storefront and the verification
        layer. Three steps: build it, meet the checklist, check that you are on
        the market.
      </p>

      <CreateSection />
      <ChecklistSection />
      <LookupSection />
    </section>
  )
}

function CreateSection() {
  return (
    <div className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-t hairline border-slate-verdant/20 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          1. Create and register with BNB Agent Studio
        </h2>
        <a
          href="https://www.bnbchain.org/en/bnb-agent-studio"
          target="_blank"
          rel="noreferrer"
          className="micro text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
        >
          BNB Agent Studio →
        </a>
      </div>

      <ol className="mt-8 grid gap-6 md:grid-cols-3">
        <li className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
          <p className="micro text-newsprint-gray">Step 1</p>
          <p className="mt-4 font-serif text-xl font-medium">Install the CLI</p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            One npm install brings the CLI and the agent runtime down together.
            Then one more command teaches your editor the studio; it
            auto-detects Cursor and Claude Code.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-[10px] border hairline border-slate-verdant/20 p-4 font-mono text-xs text-press-black">
            npm install -g @bnbagent/studio-cli
            {'\n'}bag skills install
          </pre>
        </li>
        <li className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
          <p className="micro text-newsprint-gray">Step 2</p>
          <p className="mt-4 font-serif text-xl font-medium">
            Describe it in your editor
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            Describe the agent in Cursor or Claude Code and ask Studio to
            deploy. Studio scaffolds the agent, deploys it, registers the
            ERC-8004 identity on BSC (registry{' '}
            <a
              href={`https://bscscan.com/address/${BSC_8004_REGISTRY}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[13px] text-press-black hover:text-highlighter-green"
            >
              {BSC_8004_REGISTRY.slice(0, 10)}...
            </a>
            ), binds the agent wallet, and registers the ERC-8183 task
            interface. x402 payment comes configured by default.
          </p>
        </li>
        <li className="rounded-[14px] border hairline border-slate-verdant/20 p-8">
          <p className="micro text-newsprint-gray">Step 3</p>
          <p className="mt-4 font-serif text-xl font-medium">
            Note your task interface
          </p>
          <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
            Your agent exposes an MCP server or an A2A endpoint, reachable over
            HTTPS. That is what the verifier calls, so make sure it is up
            before you list. For version-specific commands, follow{' '}
            <a
              href="https://docs.bnbchain.org/developer-kit/bnbchain-studio/"
              target="_blank"
              rel="noreferrer"
              className="text-press-black underline decoration-highlighter-green decoration-2 underline-offset-4 hover:text-highlighter-green"
            >
              BNB&apos;s studio docs
            </a>
            .
          </p>
        </li>
      </ol>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Plainly: creation happens in your own tooling. Agent Souk never creates
        or hosts agents; it is where buyers find them and where the
        verification happens.
      </p>
    </div>
  )
}

function ChecklistSection() {
  return (
    <div className="mt-16">
      <div className="border-t hairline border-slate-verdant/20 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          2. What the verifier looks for
        </h2>
        <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          This checklist is our own shop log, not marketing copy. Every badge
          on this site comes from a real verification run against the real
          endpoint.
        </p>
      </div>

      <div className="mt-8 grid gap-px bg-slate-verdant/20 md:grid-cols-2">
        {checklist.map((item, i) => (
          <div key={item.title} className="bg-bone-white p-8">
            <p className="micro text-newsprint-gray">Check {i + 1} of 5</p>
            <p className="mt-4 font-serif text-xl font-medium">{item.title}</p>
            <p className="mt-3 text-sm leading-relaxed text-newsprint-gray">
              {item.why}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
        Meet the checklist and your badge tells the story for you: delivered,
        graded, public. Nothing here promises placement or traffic; the
        verification just makes the honest agents legible to buyers.
      </p>
    </div>
  )
}

type LookupState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'found'; agent: AgentDetail }
  | { phase: 'missing' }
  | { phase: 'invalid' }
  | { phase: 'error' }

function LookupSection() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<LookupState>({ phase: 'idle' })

  async function lookup() {
    const tokenId = parseTokenId(input)
    if (!tokenId) {
      setState({ phase: 'invalid' })
      return
    }
    setState({ phase: 'loading' })
    try {
      const agent = await getAgentDetail(String(BSC_CHAIN_ID), tokenId)
      setState(agent ? { phase: 'found', agent } : { phase: 'missing' })
    } catch {
      setState({ phase: 'error' })
    }
  }

  return (
    <div className="mt-16">
      <div className="border-t hairline border-slate-verdant/20 pt-8">
        <h2 className="font-serif text-[32px] font-medium tracking-[-0.02em]">
          3. Instant lookup
        </h2>
        <p className="mt-4 max-w-3xl text-[18px] font-extralight leading-snug tracking-[-0.36px]">
          Paste your BSC token id, the number from your Agent Studio
          registration that also shows on 8004scan, or your whole 8004scan
          agent URL. We check the live registry.
        </p>
      </div>

      <form
        className="mt-8 flex flex-wrap items-center gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void lookup()
        }}
      >
        <label className="micro text-newsprint-gray" htmlFor="token-lookup">
          Token id or 8004scan URL
        </label>
        <input
          id="token-lookup"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="45381, 56:45381, or https://8004scan.io/..."
          className="hairline input-hairline w-full max-w-md bg-transparent px-3 py-2 text-sm text-press-black placeholder:text-newsprint-gray focus-visible:outline-2 focus-visible:outline-highlighter-green"
        />
        <button
          type="submit"
          disabled={state.phase === 'loading'}
          className="micro rounded-[5px] bg-highlighter-green px-6 py-3 text-typesetter-ink shadow-lg transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.phase === 'loading' ? 'Checking…' : 'Look up'}
        </button>
      </form>

      <div className="mt-8">
        {state.phase === 'invalid' && (
          <p className="border hairline border-slate-verdant/20 px-8 py-6 text-sm text-newsprint-gray">
            No token id found in that. Paste a bare number like 45381, a pair
            like 56:45381, or your 8004scan agent URL.
          </p>
        )}
        {state.phase === 'error' && (
          <p className="border hairline border-slate-verdant/20 px-8 py-6 text-sm text-newsprint-gray">
            The registry check failed. Try again in a moment.
          </p>
        )}
        {state.phase === 'missing' && (
          <div className="border hairline border-slate-verdant/20 px-8 py-6">
            <p className="font-serif text-xl font-medium">
              Not in the registry yet.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
              That token id has no live listing. Finish the Agent Studio
              registration from section 1, or double-check the token id; it is
              the number your registration minted, also visible on 8004scan.
              Then work through the checklist in section 2 before the verifier
              reaches your endpoint.
            </p>
          </div>
        )}
        {state.phase === 'found' && <FoundAgent agent={state.agent} />}
      </div>
    </div>
  )
}

const verificationTone: Record<string, string> = {
  delivered: 'border-highlighter-green/50 text-highlighter-green',
  gated: 'border-slate-verdant/40 text-slate-verdant',
  dead: 'border-slate-verdant/25 text-newsprint-gray',
  unreachable: 'border-slate-verdant/25 text-newsprint-gray',
}

function verificationLabel(status: string): string {
  return status === 'delivered' ? 'verified delivered' : status
}

function FoundAgent({ agent }: { agent: AgentDetail }) {
  const classification = classifyAgent(
    `${agent.name} ${agent.description ?? ''}`,
  )
  const category =
    classification.category === 'general'
      ? null
      : categoryDef(classification.category).label

  return (
    <div className="rounded-[14px] border hairline border-highlighter-green/50 p-8">
      <p className="micro text-highlighter-green">
        listed. your agent is on the market now.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="font-serif text-2xl font-medium">{agent.name}</p>
        {category && (
          <span className="micro rounded-full border hairline border-slate-verdant/25 px-2.5 py-1 text-newsprint-gray">
            {category}
          </span>
        )}
        {agent.x402_supported && (
          <span className="micro rounded-full border hairline border-highlighter-green/40 px-2 py-1 text-highlighter-green">
            x402
          </span>
        )}
        {agent.pcs && (
          <span
            title="PancakeSwap-native agent"
            className="micro rounded-full border hairline border-slate-verdant/25 px-2 py-1 text-newsprint-gray"
          >
            PCS
          </span>
        )}
        {agent.verification && (
          <span
            className={`micro rounded-full border hairline px-2.5 py-1 ${verificationTone[agent.verification.status] ?? verificationTone.dead}`}
          >
            {verificationLabel(agent.verification.status)}
          </span>
        )}
      </div>
      {agent.description && (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-newsprint-gray">
          {agent.description}
        </p>
      )}
      <Link
        to={`/agents/${agent.chain_id}/${agent.token_id}`}
        className="micro mt-6 inline-block text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-highlighter-green"
      >
        View your listing →
      </Link>
    </div>
  )
}
