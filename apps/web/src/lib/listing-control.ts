// must match src/lib/listing-control.ts, which the delist route verifies against;
// tests/test-listing-control.ts keeps the two equal

export type ListingAction = 'delist' | 'relist'

export function listingControlMessage(
  chainId: number,
  tokenId: string,
  owner: string,
  action: ListingAction,
): string {
  return [
    'Agent Souk listing control',
    `chainId: ${chainId}`,
    `tokenId: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
    `action: ${action}`,
  ].join('\n')
}
