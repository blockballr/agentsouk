// The strategy layer: the half that chooses. The contract decides what may move
// (floor, drawdown budget and slippage are checked on chain by HireVault); this
// decides when a rung is crossed, how much the plan places there, when the
// ladder recentres, and when everything stops. It never reads and never sends:
// the runner hands it the hire, the price and the cache, and gets intents back.
//
// Both price scales agree on purpose: the contract's refPriceX96 is token1 per
// token0 in Q96, and the runner reads the pool as quote per base (USDT per
// WBNB), which is the same number for the bound pair's ordering and decimals, so
// a crossing is a comparison and never a currency conversion.

export interface StrategyPolicy {
  /** the band's width around the reference price, in percent */
  widthPct: number;
  /** rungs in the band, endpoints included */
  levels: number;
}

// the agent card's own example shape: ten percent wide in eleven rungs
export const DEFAULT_STRATEGY_WIDTH_PCT = 10;
export const DEFAULT_STRATEGY_LEVELS = 11;
/** the planner's own bounds, so the policy never outranks them */
export const MIN_STRATEGY_LEVELS = 2;
export const MAX_STRATEGY_LEVELS = 200;

export function policyFromEnv(env: Record<string, string | undefined>): StrategyPolicy {
  const width = Number(env.GRID_STRATEGY_WIDTH_PCT ?? "");
  const levels = Number(env.GRID_STRATEGY_LEVELS ?? "");
  return {
    widthPct:
      Number.isFinite(width) && width > 0 && width <= 100 ? width : DEFAULT_STRATEGY_WIDTH_PCT,
    levels:
      Number.isInteger(levels) && levels >= MIN_STRATEGY_LEVELS && levels <= MAX_STRATEGY_LEVELS
        ? levels
        : DEFAULT_STRATEGY_LEVELS,
  };
}

/** what the chain says about the hire; the layer adds nothing to it */
export interface HireFacts {
  id: bigint;
  open: boolean;
  expiry: number;
  balanceA: bigint;
  balanceB: bigint;
  refPriceX96: bigint;
  depositInToken0: bigint;
  maxSlippageBps: number;
}

/** the cache; anything in here that the chain later contradicts loses */
export interface StrategyState {
  generation: number;
  lastBlock: bigint;
  lastPrice: number;
  /** intent keys already acted, "generation:rung:side" */
  crossed: string[];
}

export interface StrategyIntent {
  key: string;
  rungIndex: number;
  /** price fell through the rung, so quote buys base; price rose, so base sells */
  side: "buyA" | "sellA";
  tokenInSide: "A" | "B";
  amountIn: bigint;
  rungPrice: number;
}

export type StrategyOutcome =
  | { action: "stop"; reason: string; state: StrategyState }
  | { action: "hold"; reason: string; state: StrategyState }
  | { action: "trade"; reason: string; intents: StrategyIntent[]; state: StrategyState };

// The ladder is derived, never stored: rung i sits at
//   rung_i = ref * (1 + width * (i / (levels - 1) - 1/2))
// in quote per base, the units refPriceX96 itself carries. Geometry is float
// arithmetic on purpose; every trade it sizes is bounded on chain regardless.
export function ladderRungs(ref: number, policy: StrategyPolicy): number[] {
  const rungs: number[] = [];
  for (let i = 0; i < policy.levels; i += 1) {
    rungs.push(ref * (1 + (policy.widthPct / 100) * (i / (policy.levels - 1) - 0.5)));
  }
  return rungs;
}

const MAX_CROSSED_KEYS = 400;

// the plan's size at one rung: that side of the deposit, divided across the
// ladder. It is bounded again by what the hire still holds when the intent runs.
function perRungSize(sideBalance: bigint, levels: number): bigint {
  return sideBalance / BigInt(levels);
}

function sideBalanceOf(hire: HireFacts, side: "buyA" | "sellA"): bigint {
  return side === "buyA" ? hire.balanceB : hire.balanceA;
}

function intentKey(generation: number, rungIndex: number, side: "buyA" | "sellA"): string {
  return `${generation}:${rungIndex}:${side}`;
}

export function initialStrategyState(lastBlock: bigint, lastPrice: number): StrategyState {
  return { generation: 0, lastBlock, lastPrice, crossed: [] };
}

export function decideHire(input: {
  hire: HireFacts;
  policy: StrategyPolicy;
  state: StrategyState | null;
  price: number;
  blockNumber: bigint;
  nowSec: number;
  kill: boolean;
}): StrategyOutcome {
  const { hire, policy, price, blockNumber, nowSec, kill } = input;
  // a missing cache arms at the live price: the first pass crosses nothing
  const base: StrategyState = input.state ?? {
    generation: 0,
    lastBlock: 0n,
    lastPrice: price,
    crossed: [],
  };

  if (kill) {
    return { action: "stop", reason: "the kill switch is thrown, so this decision is a no-op", state: base };
  }
  if (!hire.open) return { action: "stop", reason: "the hire is not open", state: base };
  if (nowSec >= hire.expiry) return { action: "stop", reason: "the hire has expired", state: base };
  const ref = Number(hire.refPriceX96) / 2 ** 96;
  if (!(ref > 0)) return { action: "stop", reason: "the hire carries no reference price", state: base };
  if (!(price > 0)) return { action: "stop", reason: "the price read yielded no positive number", state: base };
  // one decision per block at most, whatever fires the run
  if (blockNumber <= base.lastBlock) {
    return { action: "hold", reason: `block ${blockNumber} was already decided`, state: base };
  }

  const rungs = ladderRungs(ref, policy);
  const low = rungs[0];
  const high = rungs[rungs.length - 1];

  if (price < low || price > high) {
    return recentre({ hire, policy, base, price, blockNumber, low, high });
  }

  const prev = base.lastPrice;
  const side: "buyA" | "sellA" | null = price < prev ? "buyA" : price > prev ? "sellA" : null;
  if (!side) {
    return {
      action: "hold",
      reason: `price ${price} sits inside [${low}, ${high}] and crossed no rung since block ${base.lastBlock}`,
      state: { ...base, lastBlock: blockNumber, lastPrice: price },
    };
  }

  const crossed: number[] = [];
  rungs.forEach((rung, i) => {
    if (side === "buyA" && rung < prev && rung >= price) crossed.push(i);
    if (side === "sellA" && rung > prev && rung <= price) crossed.push(i);
  });

  const plan = sideBalanceOf(hire, side);
  const size = perRungSize(plan, policy.levels);
  let remaining = plan;
  const intents: StrategyIntent[] = [];
  for (const i of crossed) {
    const key = intentKey(base.generation, i, side);
    if (base.crossed.includes(key)) continue;
    const amount = size < remaining ? size : remaining;
    if (amount <= 0n) break;
    remaining -= amount;
    intents.push({
      key,
      rungIndex: i,
      side,
      tokenInSide: side === "buyA" ? "B" : "A",
      amountIn: amount,
      rungPrice: rungs[i],
    });
  }

  const next: StrategyState = {
    ...base,
    lastBlock: blockNumber,
    lastPrice: price,
    crossed:
      intents.length > 0
        ? [...base.crossed, ...intents.map((i) => i.key)].slice(-MAX_CROSSED_KEYS)
        : base.crossed,
  };

  if (intents.length === 0) {
    const reason =
      crossed.length === 0
        ? `no rung between ${prev} and ${price} was crossed`
        : size === 0n
          ? `rungs were crossed but the ${side} side of the deposit holds nothing`
          : `the rungs between ${prev} and ${price} were already acted at generation ${base.generation}`;
    return { action: "hold", reason, state: next };
  }

  return {
    action: "trade",
    reason: `${side === "buyA" ? "a fall" : "a rise"} through ${intents.length} rung${intents.length === 1 ? "" : "s"} between ${prev} and ${price}`,
    intents,
    state: next,
  };
}

// A band left behind is a static grid in a trend, so the ladder is rebuilt
// around the price that left and the position takes one rung-sized step back
// toward the new centre. One step, not the balance: the vault bounds whatever
// this decides, and a step is the size the plan places at one rung.
function recentre(input: {
  hire: HireFacts;
  policy: StrategyPolicy;
  base: StrategyState;
  price: number;
  blockNumber: bigint;
  low: number;
  high: number;
}): StrategyOutcome {
  const { hire, policy, base, price, blockNumber, low, high } = input;
  const generation = base.generation + 1;
  const recentred = ladderRungs(price, policy);
  const side: "buyA" | "sellA" = price > high ? "buyA" : "sellA";
  const plan = sideBalanceOf(hire, side);
  const size = perRungSize(plan, policy.levels);

  let rungIndex = 0;
  recentred.forEach((rung, i) => {
    if (Math.abs(rung - price) < Math.abs(recentred[rungIndex] - price)) rungIndex = i;
  });

  const intents: StrategyIntent[] = [];
  if (size > 0n) {
    intents.push({
      key: intentKey(generation, rungIndex, side),
      rungIndex,
      side,
      tokenInSide: side === "buyA" ? "B" : "A",
      amountIn: size,
      rungPrice: recentred[rungIndex],
    });
  }

  return {
    action: "trade",
    reason: `price ${price} left the band [${low}, ${high}]; the ladder recentred as generation ${generation} and stepped toward the new centre`,
    intents,
    state: {
      generation,
      lastBlock: blockNumber,
      lastPrice: price,
      crossed: intents.map((i) => i.key),
    },
  };
}
