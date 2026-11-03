import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CATEGORIES, categoryDef, type CategoryDef, type CategoryKey } from '@agora/core'
import { Btn, Label, Row, Stack, Txt } from './souk'
import { chainLabel, explorerAddressUrl, REGISTRY_BY_CHAIN, registryFor } from '../lib/contracts'
import { areaClass, inputClass, labelClass } from '../lib/form-classes'
import { Dialog } from './ui/parts'

// The Studio guide: how an agent gets built and deployed before it is listed here.
// It lives with the build page now, so the listing form is only the form.

function CodeBlock({ lines }: { lines: string[] }) {
  return (
    <Stack
      gap={4}
      pad={[14, 16, 14, 16]}
      radius={8}
      className="border border-souk-hair bg-souk-surface2"
    >
      {lines.map((line) => (
        <Txt key={line} size={12} lead={18} mono tone="ink">
          {line}
        </Txt>
      ))}
    </Stack>
  )
}

export function StudioSteps({
  chainId,
  onReveal,
}: {
  chainId: number | null
  onReveal?: () => void
}) {
  // the addresses we publish are the ones for the chain this deployment serves
  const chainName = chainId === null ? null : chainId === 97 ? 'BSC testnet' : 'BSC'
  const registryAddress = chainId === null ? null : registryFor(chainId) ?? REGISTRY_BY_CHAIN[56]
  return (
    <>
    <Stack gap={20}>
      <ol className="grid items-stretch gap-5 md:grid-cols-2">
        <li className="flex h-full">
          <div className="relative h-full w-full">
            <span className="absolute -top-2.5 left-2 inline-flex items-center truncate rounded-full border border-white/15 bg-souk-indigo/90 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] text-souk-white shadow-[0_2px_10px_rgba(2,8,40,0.35)] backdrop-blur-md">
              Step 1
            </span>
            <Stack surface gap={10} pad={[20, 22, 18, 22]} className="w-full h-full">
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Install the CLI</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              One npm install brings the CLI and the runtime. One more command sets up your editor,
              Cursor or Claude Code. The new wallet is funded with test BNB and test stablecoin for
              you.
            </Txt>
            <CodeBlock lines={['npm install -g @bnbagent/studio-cli', 'bag skills install']} />
          </Stack>
          </div>
        </li>
        <li className="flex h-full">
          <div className="relative h-full w-full">
            <span className="absolute -top-2.5 left-2 inline-flex items-center truncate rounded-full border border-white/15 bg-souk-indigo/90 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] text-souk-white shadow-[0_2px_10px_rgba(2,8,40,0.35)] backdrop-blur-md">
              Step 2
            </span>
            <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full h-full">
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Describe your agent</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              In Cursor or Claude Code, say what the agent does and ask Studio to deploy it. Studio
              scaffolds the agent, deploys it, registers the ERC-8004 identity on{' '}
              {chainName ?? 'the target network'} (
              {chainId !== null && registryAddress ? (
                <a
                  href={explorerAddressUrl(chainId, registryAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-[11px] text-souk-ink hover:text-souk-data"
                >
                  registry {registryAddress}
                </a>
              ) : (
                'registry pending'
              )}
              ), binds the agent wallet, and registers the ERC-8183 task interface. x402 payment
              comes configured by default.
            </Txt>
          </Stack>
          </div>
        </li>
        <li className="flex h-full">
          <PromptGeneratorCard chainId={chainId} onReveal={onReveal} />
        </li>
        <li className="flex h-full">
          <div className="relative h-full w-full">
            <span className="absolute -top-2.5 left-2 inline-flex items-center truncate rounded-full border border-white/15 bg-souk-indigo/90 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] text-souk-white shadow-[0_2px_10px_rgba(2,8,40,0.35)] backdrop-blur-md">
              Step 4
            </span>
            <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full h-full">
            <Txt size={18} lead={26} weight="bold" tone="ink" className="block">Note your task interface</Txt>
            <Txt size={13} lead={20} tone="slate" className="block">
              Your agent exposes an MCP server or an A2A endpoint, reachable over HTTPS. That is
              what the verifier calls, so make sure it is up before you list. For version-specific
              commands, follow{' '}
              <a
                href="https://docs.bnbchain.org/developer-kit/bnbchain-studio/"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-souk-hair underline-offset-4 hover:text-souk-ink"
              >
                <Txt size={13} lead={20} tone="ink">BNB&apos;s studio docs</Txt>
              </a>
              .
            </Txt>
            <Row>
              <Link to="/list">
                <Btn kind="off">Continue to listing</Btn>
              </Link>
            </Row>
          </Stack>
          </div>
        </li>
      </ol>

      <Txt size={13} lead={20} tone="steel" className="block max-w-[1180px]">
        Studio builds and deploys the agent. Agent Souk is where buyers find it and where we check it.
      </Txt>
    </Stack>
    </>
  )
}

function buildDescription(
  def: CategoryDef,
  name: string,
  goal: string,
): string {
  const clean = goal.trim().replace(/\s+/g, ' ')
  const named = name.trim() ? `${name.trim()} is` : 'This agent is'
  let text = `${named} a ${def.label.toLowerCase()} agent for BNB Chain. ${def.blurb}`
  if (clean) text += ` What it should achieve: ${clean}.`
  return text
}

function buildPrompt(
  category: CategoryKey,
  name: string,
  goal: string,
  chainId: number | null,
): string {
  const def = categoryDef(category)
  const description = buildDescription(def, name, goal)
  const label = name.trim() || `a ${def.label.toLowerCase()} agent`
  // derived, not pasted: the registry must be the one this deployment indexes
  const networkName = chainId === null ? 'the target network' : chainLabel(chainId)
  const registryAddress = chainId === null ? null : registryFor(chainId) ?? REGISTRY_BY_CHAIN[56]
  const registryNote = registryAddress
    ? `(registry ${registryAddress}${chainId === 97 ? ', chain 97' : ''})`
    : '(registry pending)'
  return [
    'Install the bnb CLI, describe this agent to Studio, and ship it end to end. Studio scaffolds the agent, deploys it, and registers the ERC-8004 identity on BSC. The agent to build is:',
    '',
    `${label} (${def.label}).`,
    '',
    'Registration description to use, so search and buyers read an honest summary:',
    description,
    '',
    'Acceptance criteria. The work is done only when all of these hold:',
    '1. The agent exposes a reachable MCP or A2A endpoint over HTTPS.',
    '2. x402Support is set in the registration.',
    `3. The registration description names the category honestly: ${def.label.toLowerCase()}, in its own words.`,
    '4. A performance or reporting tool is exposed, for example get_performance, that returns live numbers.',
    '5. Exactly one registration is made, not a numbered series of duplicates.',
    '',
    // The registry address must be the one this deployment indexes (chain 97), and the origin
    // the judged domain; a mainnet registry or wrong origin makes listing silently fail.
    `When done, the agent must be registered on ${networkName} ERC-8004 ${registryNote} and appear when searched on agentsouk.xyz.`,
  ].join('\n')
}

// step 3's own card: three questions asked in a dialog, the verification checklist
// reused as the prompt's acceptance criteria and revealed from the line that names it

function PromptGeneratorCard({ chainId, onReveal }: { chainId: number | null; onReveal?: () => void }) {
  const [category, setCategory] = useState<CategoryKey>('rebalancing')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  function generate() {
    setPrompt(buildPrompt(category, name, goal, chainId))
    setCopied(false)
  }

  async function copy() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="relative w-full h-full">
      <span className="absolute -top-2.5 left-2 inline-flex items-center truncate rounded-full border border-white/15 bg-souk-indigo/90 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.06em] text-souk-white shadow-[0_2px_10px_rgba(2,8,40,0.35)] backdrop-blur-md">
        Step 3
      </span>
      <Stack surface gap={10} pad={[20, 22, 20, 22]} className="w-full">
      <Txt size={18} lead={26} weight="bold" tone="ink" className="block">
        Generate your Agent Studio prompt
      </Txt>
      <Txt size={13} lead={20} tone="slate" className="block">
        Answer three questions and we write a prompt for your coding agent, with{' '}
        <button
          type="button"
          onClick={() => onReveal?.()}
          className="cursor-pointer text-souk-ink underline decoration-souk-hair underline-offset-4 transition hover:text-souk-data focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
        >
          our verification checklist
        </button>{' '}
        as its acceptance criteria.
      </Txt>
      <Row>
        <Btn kind="off" onClick={() => setOpen(true)}>Generate prompt</Btn>
      </Row>

      {open && (
        <Dialog title="Generate your Agent Studio prompt" onClose={() => setOpen(false)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="wizard-category">
                <Label tone="labels">Category</Label>
              </label>
              <div className="mt-2">
                <select
                  id="wizard-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryKey)}
                  className={inputClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="wizard-name">
                <Label tone="labels">Agent name (one line)</Label>
              </label>
              <div className="mt-2">
                <input
                  id="wizard-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="BNB Lending Guardian"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className={labelClass} htmlFor="wizard-goal">
              <Label tone="labels">What the agent should achieve</Label>
            </label>
            <div className="mt-2">
              <textarea
                id="wizard-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                placeholder="Watch borrowing positions on Venus and protect them before liquidation hits."
                className={areaClass}
              />
            </div>
          </div>

          <Row className="mt-6">
            <Btn kind="primary" onClick={generate}>Generate prompt</Btn>
          </Row>

          {prompt && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-4">
                <Label tone="labels">Your prompt</Label>
                <Btn kind="off" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn>
              </div>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-[8px] border border-souk-hair bg-souk-surface2 p-4 font-mono text-[11px] leading-[18px] text-souk-ink">
                {prompt}
              </pre>
            </div>
          )}
        </Dialog>
      )}
    </Stack>
    </div>
  )
}

