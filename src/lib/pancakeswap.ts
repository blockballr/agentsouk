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

export function isPancakeSwapAgent(name: string, description: string): boolean {
  const text = `${name} ${description}`;
  return (
    pancakeSwapScore(name, description) >= 2 &&
    EXPLICIT_PCS_TERMS.some((re) => re.test(text))
  );
}
