// pancake swap surfacing: a listing is pcs-native when its own registration
// text carries at least two pcs signals (same spirit as the category
// classifier threshold) AND at least one explicit pcs term (pancakeswap,
// pcs v3, or stableswap), so generic signals like v3 pool never qualify an
// agent that never mentions pancake swap
const PCS_SIGNALS: [RegExp, number][] = [
  [/pancakeswap/i, 2],
  [/pcs\s*v3/i, 2],
  [/v3\s*pool/i, 1],
  [/stableswap/i, 2],
  [/\bcake\b/i, 1],
  [/concentrated.{0,20}liquidity/i, 1],
  [/lp\s*range|range\s*(order|position)/i, 1],
];

const EXPLICIT_PCS_TERMS: RegExp[] = [/pancakeswap/i, /pcs\s*v3/i, /stableswap/i];

export function pancakeSwapScore(name: string, description: string): number {
  const text = `${name} ${description}`;
  return PCS_SIGNALS.reduce((score, [re, weight]) => (re.test(text) ? score + weight : score), 0);
}

// agents this marketplace runs itself and has watched read PancakeSwap v3 on chain, so
// their tag rests on what they do rather than on what their description says
const PANCAKESWAP_READERS: Record<number, ReadonlySet<string>> = {
  97: new Set(["2522"]), // Souk Grid Planner, pair mode reads the WBNB/USDT pool
};

export function readsPancakeSwap(chainId: number, tokenId: string): boolean {
  return PANCAKESWAP_READERS[chainId]?.has(String(tokenId)) ?? false;
}

export function isPancakeSwapAgent(name: string, description: string): boolean {
  const text = `${name} ${description}`;
  return (
    pancakeSwapScore(name, description) >= 2 &&
    EXPLICIT_PCS_TERMS.some((re) => re.test(text))
  );
}
