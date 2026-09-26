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
