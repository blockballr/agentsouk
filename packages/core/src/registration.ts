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
  category: ListableCategory
  endpoint?: string
  endpointKind?: EndpointKind
  image?: string
  x402Support?: boolean
}
