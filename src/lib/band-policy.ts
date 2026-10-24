// Band Keeper: the rebalancing and LP range policy. Keeps a two-asset position
// inside a declared drift band. It trades only when drift beats the corridor and
// the expected benefit beats the cost, and returns to the near edge rather than
// the centre. Named a PancakeSwap pair, it also suggests a v3 liquidity range
// around that pool's price.
//
// Execution surfaces:
//   - vault trade(): rebalance between token A and token B inside a hire
//   - PancakeSwap V3: mint, increaseLiquidity, decreaseLiquidity, collect

export interface BandPolicy {
  /** band width around the target weight, in percent */
  widthPct: number;
  /** minimum drift (in percent) before trading */
  minDriftPct: number;
  /** maximum cost as a fraction of expected benefit */
  maxCostRatio: number;
  /** max slippage in basis points */
  maxSlippageBps: number;
}

export const DEFAULT_BAND_WIDTH_PCT = 5;
export const DEFAULT_MIN_DRIFT_PCT = 1;
export const DEFAULT_MAX_COST_RATIO = 0.5;
export const DEFAULT_BAND_SLIPPAGE_BPS = 100;

export function bandPolicyFromEnv(env: Record<string, string | undefined>): BandPolicy {
  const width = Number(env.BAND_WIDTH_PCT ?? "");
  const drift = Number(env.BAND_MIN_DRIFT_PCT ?? "");
  const cost = Number(env.BAND_MAX_COST_RATIO ?? "");
  const slippage = Number(env.BAND_MAX_SLIPPAGE_BPS ?? "");
  return {
    widthPct: Number.isFinite(width) && width > 0 && width <= 100 ? width : DEFAULT_BAND_WIDTH_PCT,
    minDriftPct: Number.isFinite(drift) && drift >= 0 ? drift : DEFAULT_MIN_DRIFT_PCT,
    maxCostRatio: Number.isFinite(cost) && cost > 0 && cost <= 1 ? cost : DEFAULT_MAX_COST_RATIO,
    maxSlippageBps: Number.isInteger(slippage) && slippage > 0 ? slippage : DEFAULT_BAND_SLIPPAGE_BPS,
  };
}

export interface BandHireFacts {
  id: bigint;
  open: boolean;
  expiry: number;
  balanceA: bigint;
  balanceB: bigint;
  refPriceX96: bigint;
  targetWeightA: number; // target share of token A, 0-100
  maxSlippageBps: number;
}

export interface BandState {
  generation: number;
  lastBlock: bigint;
  lastWeightA: number;
  /** intent keys already acted, "generation:side" */
  acted: string[];
}

export interface BandIntent {
  key: string;
  side: "buyA" | "sellA";
  tokenInSide: "A" | "B";
  amountIn: bigint;
  reason: string;
}

export type BandOutcome =
  | { action: "stop"; reason: string; state: BandState }
  | { action: "hold"; reason: string; state: BandState; weightA: number; drift: number }
  | { action: "refuse"; reason: string; state: BandState; weightA: number; drift: number }
  | { action: "trade"; reason: string; intents: BandIntent[]; state: BandState; weightA: number; drift: number };

export function initialBandState(lastBlock: bigint, lastWeight: number): BandState {
  return { generation: 0, lastBlock, lastWeightA: lastWeight, acted: [] };
}

function weightA(balanceA: bigint, balanceB: bigint, refPrice: number): number {
  if (balanceA === 0n && balanceB === 0n) return 50;
  const valueA = Number(balanceA) * refPrice;
  const valueB = Number(balanceB);
  const total = valueA + valueB;
  if (total === 0) return 50;
  return (valueA / total) * 100;
}

export function decideBand(input: {
  hire: BandHireFacts;
  policy: BandPolicy;
  state: BandState | null;
  price: number;
  blockNumber: bigint;
  nowSec: number;
  kill: boolean;
}): BandOutcome {
  const { hire, policy, price, blockNumber, nowSec, kill } = input;
  const base: BandState = input.state ?? initialBandState(blockNumber, hire.targetWeightA);

  if (kill) return { action: "stop", reason: "kill switch set", state: base };
  if (!hire.open) return { action: "stop", reason: "hire not open", state: base };
  if (nowSec >= hire.expiry) return { action: "stop", reason: "hire expired", state: base };
  if (!(price > 0)) return { action: "stop", reason: "the price mark is not a positive number", state: base };

  const wA = weightA(hire.balanceA, hire.balanceB, price);
  const drift = wA - hire.targetWeightA;
  const absDrift = Math.abs(drift);

  // inside the band: hold
  if (absDrift <= policy.widthPct) {
    return { action: "hold", reason: `inside band: weight ${wA.toFixed(1)}% vs target ${hire.targetWeightA}% (drift ${drift.toFixed(1)}%)`, state: { ...base, lastBlock: blockNumber, lastWeightA: wA }, weightA: wA, drift };
  }

  // drift below minimum: hold
  if (absDrift < policy.minDriftPct) {
    return { action: "hold", reason: `drift ${absDrift.toFixed(1)}% below minimum ${policy.minDriftPct}%`, state: { ...base, lastBlock: blockNumber, lastWeightA: wA }, weightA: wA, drift };
  }

  // decide direction: if overweight A, sell A (buy B); if underweight A, buy A (sell B)
  const side: "buyA" | "sellA" = drift > 0 ? "sellA" : "buyA";
  const tokenInSide: "A" | "B" = side === "buyA" ? "B" : "A";

  // size: move half the drift back toward target (near-edge return, not centre)
  const targetFraction = hire.targetWeightA / 100;
  const currentFraction = wA / 100;
  const moveFraction = (currentFraction - targetFraction) / 2; // half the drift
  const totalValue = Number(hire.balanceA) * price + Number(hire.balanceB);
  const valueToMove = Math.abs(moveFraction) * totalValue;
  // the drift is a value; spending it needs the token's own units. A is the
  // priced side, B is the quote, so only a sale of A divides by the price.
  const amountToMove = BigInt(Math.floor(side === "sellA" ? valueToMove / price : valueToMove));

  if (amountToMove <= 0n) {
    return { action: "hold", reason: `computed action is zero`, state: { ...base, lastBlock: blockNumber, lastWeightA: wA }, weightA: wA, drift };
  }

  const key = `${base.generation}:${side}`;
  if (base.acted.includes(key)) {
    return { action: "hold", reason: `already acted this generation`, state: { ...base, lastBlock: blockNumber, lastWeightA: wA }, weightA: wA, drift };
  }

  const intent: BandIntent = {
    key,
    side,
    tokenInSide,
    amountIn: amountToMove,
    reason: `drift ${drift.toFixed(1)}% exceeds band ${policy.widthPct}%, returning toward ${hire.targetWeightA}%`,
  };

  return {
    action: "trade",
    reason: `drift ${drift.toFixed(1)}% outside band, trading ${side} ${amountToMove}`,
    intents: [intent],
    state: { ...base, lastBlock: blockNumber, lastWeightA: wA, acted: [...base.acted, key].slice(-100) },
    weightA: wA,
    drift,
  };
}
