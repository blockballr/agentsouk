// What an agent can sell through this marketplace, and who owns the guarantee.
// The rails are returned in shelf order: vault, job, call. A vault is open only
// when our HireVault, or a self-run executor the seller declares, holds the
// deposit. A job is open when the marketplace can quote the seller, either
// because the listing names our escrow or because it publishes an endpoint we
// can dial for a signed price; the quote funds the shared ERC-8183 kernel either
// way. A call is open to a callable endpoint that also takes direct work; a
// job-only seller's endpoint is the job protocol, not a paid call.
import { sellsByJob, takesJobs, takesVault } from '@agora/core'
import type { AgentDetail } from '../core/types'
import { ESCROW_FUNDER_BY_CHAIN, VAULT_BY_CHAIN } from './contracts'

export type RailKind = 'job' | 'vault' | 'call'
export type RailSource = 'agent-souk' | 'verified' | 'agent'

export interface AgentRail {
  kind: RailKind
  source: RailSource
  title: string
  body: string
}

const KIND = {
  vault: {
    title: 'Vault hire',
    body: 'The deposit stays in HireVault. The agent trades inside the band you sign.',
  },
  job: {
    title: 'Escrow job',
    body: 'Agree a price, fund the ERC-8183 job, and release against the delivery.',
  },
  call: {
    title: 'Direct call',
    body: 'One x402 payment, one answer at the agent endpoint.',
  },
} as const

function manifestText(detail: AgentDetail): string {
  return [
    detail.raw_metadata,
    detail.services,
    detail.agent_url,
    detail.a2a_endpoint,
    detail.mcp_server,
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => JSON.stringify(value))
    .join(' ')
    .toLowerCase()
}

function mentions(text: string, address: string | undefined): boolean {
  return Boolean(address) && text.includes(String(address).toLowerCase())
}

export function agentRails(detail: AgentDetail, house: boolean): AgentRail[] {
  const rails: AgentRail[] = []
  const text = manifestText(detail)
  const jobOnly = sellsByJob(detail.skills)
  const jobDeclared = jobOnly || takesJobs(detail.skills)
  const vaultDeclared = takesVault(detail.skills)
  // the delivery path dials MCP first, then A2A; the job quote only speaks A2A,
  // so a job rail needs an A2A endpoint even when the card names our escrow
  const callable = detail.mcp_server ?? detail.a2a_endpoint
  const quotable = detail.a2a_endpoint
  // a gated listing answers only behind the seller's own credentials. the
  // marketplace holds none, so a call or job would be paid and reach a wall;
  // the vault still runs because the seller's executor does the trading
  const gated = detail.accessGated === true
  const namesOurEscrow = house || mentions(text, ESCROW_FUNDER_BY_CHAIN[detail.chain_id])

  // the shelf leads with the vault, then the job, then the call, and every
  // surface renders the rails in this order
  if (vaultDeclared && (house || mentions(text, VAULT_BY_CHAIN[detail.chain_id]))) {
    rails.push({
      kind: 'vault',
      source: house ? 'agent-souk' : 'verified',
      ...KIND.vault,
    })
  }

  // a third-party seller does not have to name our escrow for a job: the quote
  // route dials its own endpoint, validates the signed price against the kernel,
  // and funds the shared ERC-8183 job, so an endpoint is enough to open the rail
  if (!gated && jobDeclared && quotable) {
    rails.push({
      kind: 'job',
      source: house ? 'agent-souk' : namesOurEscrow ? 'verified' : 'agent',
      ...KIND.job,
    })
  }

  // a job-only seller publishes the job protocol at its endpoint, not a paid
  // call. offering one would take the money and reach no delivery, so the rail
  // is omitted; its bookable action is the job above.
  if (!gated && callable && !jobOnly) {
    rails.push({
      kind: 'call',
      source: house ? 'agent-souk' : 'agent',
      ...KIND.call,
    })
  }

  return rails
}

export function railSourceLabel(source: RailSource): string {
  if (source === 'agent-souk') return 'Built by Agent Souk'
  if (source === 'verified') return 'Verified rail'
  return 'Agent endpoint'
}
