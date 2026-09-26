// Contract addresses for the chain the site is actually serving.
//
// The listing page used to print a single hardcoded mainnet registry, truncated,
// linked to the mainnet explorer. On the chain-97 deployment that is worse than
// missing: a judge or agent operator clicks the link and lands on a contract
// none of our agents are registered in. The brief asks us to show the contract
// addresses, so they are shown in full and they are the ones for this chain.
//
// The full address is printed rather than elided. A truncated address cannot be
// pasted into a wallet or an explorer, which is the only reason to want it.

export const REGISTRY_BY_CHAIN: Record<number, string> = {
  56: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
  97: '0x8004a818bfb912233c491871b3d84c89a494bd9e',
}

// what a hire settles in, per chain. On testnet this is sUSD, the EIP-3009 token
// we deployed for the campaign, because the chain-97 build of $U has
// transferWithAuthorization disabled and reverts.
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
  const host = chainId === 97 ? 'https://testnet.bscscan.com' : 'https://bscscan.com'
  return `${host}/address/${address}`
}
