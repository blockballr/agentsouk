// the default faces an agent falls back to when it carries no usable image.
// the pick is keyed on the listing, so an agent keeps its default for its
// whole life instead of swapping between visits
const FALLBACKS = [
  '/inserts/arc.svg',
  '/inserts/keystone.svg',
  '/inserts/orbit.svg',
  '/inserts/vertex.svg',
  '/inserts/beam.svg',
  '/inserts/knot.svg',
] as const

export function defaultAvatarFor(chainId: number, tokenId: string): string {
  const key = `${chainId}/${tokenId}`
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return FALLBACKS[hash % FALLBACKS.length]
}
