// the wallet that owns the marketplace's own agents, declared as a team wallet in
// the tracking addendum; the owner is an on-chain fact, so the label cannot drift
const OPERATOR_OWNERS = new Set(['0x84fedabd1b83443ad86796c15619494878b64180'])

export const OPERATED_BY_LABEL = 'By Agent Souk'
export const OPERATED_BY_TITLE =
  'Operated by Agent Souk. A first-party agent, disclosed, with the same verification as every listing.'

export function isOperatedByAgentSouk(owner: string | null | undefined): boolean {
  return !!owner && OPERATOR_OWNERS.has(owner.toLowerCase())
}
