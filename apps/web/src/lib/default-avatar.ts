// the default face an agent falls back to when it carries no usable image.
// uses DiceBear's Bottts style: a deterministic robot avatar keyed on the
// listing, so an agent keeps its default for its whole life instead of
// swapping between visits. No API key needed; the public endpoint is free.
export function defaultAvatarFor(chainId: number, tokenId: string): string {
  const seed = `${chainId}/${tokenId}`;
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&backgroundType=gradientLinear`;
}