// The shape of a listing draft, shared between the form that collects it and the server that validates it.

export const LISTABLE_CATEGORIES = [
  'rebalancing',
  'grid-trading',
  'yield',
  'health-factor',
] as const

export type ListableCategory = (typeof LISTABLE_CATEGORIES)[number]

export const ENDPOINT_KINDS = ['web', 'A2A', 'MCP'] as const

export type EndpointKind = (typeof ENDPOINT_KINDS)[number]

export interface RegistrationDraft {
  name: string
  description: string
  // '' means "not chosen": the shelf falls back to the classifier, which is
  // better than silently filing under the form's old yield default
  category: ListableCategory | ''
  endpoint?: string
  // which protocols the endpoint speaks; a listing may speak more than one, so
  // this is a list rather than a single choice. endpointKind is kept for the
  // registrations that were minted before the list existed.
  endpointKinds?: EndpointKind[]
  endpointKind?: EndpointKind
  image?: string
  x402Support?: boolean
  // where a hire pays the agent, written into the registration document the
  // lister signs; absent means the document states no wallet
  agentWallet?: string
}
