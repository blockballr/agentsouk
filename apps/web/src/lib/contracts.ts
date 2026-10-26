// Contract addresses for the chain this site serves, printed in full rather than elided.

export const REGISTRY_BY_CHAIN: Record<number, string> = {
  56: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
  97: '0x8004a818bfb912233c491871b3d84c89a494bd9e',
}

// what a hire settles in, per chain. On testnet this is sUSD, our EIP-3009 token.
export const SETTLEMENT_ASSET_BY_CHAIN: Record<number, { symbol: string; address: string }> = {
  56: { symbol: '$U', address: '0xcE24439F2D9C6a2289F741120FE202248B666666' },
  97: { symbol: 'sUSD', address: '0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53' },
}

// the HireVault custody contract, the Aave V3 venue adapter, and the escrow pair
export const VAULT_BY_CHAIN: Record<number, string> = {
  56: '0x028129c230123a46f4305ce0d2b29f8ac5255149',
  97: '0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74',
}

export const VENUE_ADAPTER_BY_CHAIN: Record<number, string> = {
  56: '0x1928578a29abab83520209cdd3a9b00c74c26e0f',
}

export const ESCROW_FUNDER_BY_CHAIN: Record<number, string> = {
  56: '0xd7052516ae58188271c4c85fa4cd69a18c6e7f8b',
}

export const RECEIPT_LEDGER_BY_CHAIN: Record<number, string> = {
  56: '0xbe3147d4a187ff9b394233943aa3fcc44bbcc184',
}

// the ERC-8004 reputation registry a rating is written to, v2.0.0 on both chains
export const REPUTATION_BY_CHAIN: Record<number, string> = {
  56: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  97: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
}

export function reputationRegistryFor(chainId: number): string | null {
  return REPUTATION_BY_CHAIN[chainId] ?? null
}

export function registryFor(chainId: number): string | null {
  return REGISTRY_BY_CHAIN[chainId] ?? null
}

export function settlementAssetFor(chainId: number): { symbol: string; address: string } | null {
  return SETTLEMENT_ASSET_BY_CHAIN[chainId] ?? null
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${explorerTxBase(chainId)}/address/${address}`
}

/** Explorer origin for a chain, for linking a transaction rather than an address. */
export function explorerTxBase(chainId: number): string {
  return chainId === 97 ? 'https://testnet.bscscan.com' : 'https://bscscan.com'
}

/** The name of a chain, for display. */
export function chainLabel(chainId: number): string {
  return chainId === 97 ? 'BSC testnet' : 'BNB Smart Chain'
}
