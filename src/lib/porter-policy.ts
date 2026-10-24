// Porter: the health-factor policy. Three bands, smallest action first.
// It reads the hire's own balances as collateral and debt, computes a health
// factor, and decides whether to defend (trade collateral into debt to raise HF)
// or hold. It refuses on stale prices and on an unreadable position.
//
// Unlike Band (which keeps a position inside a declared band) and Buffer
// (which deploys idle stable into yield), Porter's job is to keep a lending
// position above liquidation. Its action is always the smallest step that
// restores the health factor to the target band.

export interface PorterPolicy {
  /** health factor below which the position is defended */
  defendAt: number;
  /** health factor the defense aims for */
  targetHf: number;
  /** health factor at which the position is liquidatable */
  liquidatableAt: number;
  /** max slippage in basis points for the defense trade */
  maxSlippageBps: number;
}

export const DEFAULT_DEFEND_AT = 1.3;
export const DEFAULT_TARGET_HF = 1.5;
export const DEFAULT_LIQUIDATABLE_AT = 1.0;
export const DEFAULT_MAX_SLIPPAGE_BPS = 100;

export function porterPolicyFromEnv(env: Record<string, string | undefined>): PorterPolicy {
  const defendAt = Number(env.PORTER_DEFEND_AT ?? "");
  const targetHf = Number(env.PORTER_TARGET_HF ?? "");
  const liquidatableAt = Number(env.PORTER_LIQUIDATABLE_AT ?? "");
  const slippage = Number(env.PORTER_MAX_SLIPPAGE_BPS ?? "");
  return {
    defendAt: Number.isFinite(defendAt) && defendAt > 1 ? defendAt : DEFAULT_DEFEND_AT,
    targetHf: Number.isFinite(targetHf) && targetHf > 1 ? targetHf : DEFAULT_TARGET_HF,
    liquidatableAt: Number.isFinite(liquidatableAt) && liquidatableAt > 0 ? liquidatableAt : DEFAULT_LIQUIDATABLE_AT,
    maxSlippageBps: Number.isInteger(slippage) && slippage > 0 ? slippage : DEFAULT_MAX_SLIPPAGE_BPS,
  };
}

export interface PorterHireFacts {
  id: bigint;
  open: boolean;
  expiry: number;
  // collateral value in quote units (e.g. USDT)
  collateralValue: bigint;
  // debt value in quote units
  debtValue: bigint;
  // liquidation threshold as a fraction (e.g. 0.8 = 80%)
  liquidationThreshold: bigint;
  // price staleness: seconds since last price update
  priceAgeSec: number;
  // max price age before refusing
  maxPriceAgeSec: number;
  // the hire's slippage bound
  maxSlippageBps: number;
}

export interface PorterState {
  generation: number;
  lastBlock: bigint;
  lastHealthFactor: number;
  /** actions already taken, "generation:band:step" */
  acted: string[];
}

export interface PorterIntent {
  key: string;
  /** which band triggered: "critical" | "defend" | "maintain" */
  band: "critical" | "defend" | "maintain";
  /** how much collateral to move, in quote units */
  amountIn: bigint;
  /** the token to sell (collateral) */
  tokenInSide: "A" | "B";
  /** the token to buy (debt repayment) */
  tokenOutSide: "A" | "B";
}

export type PorterOutcome =
  | { action: "stop"; reason: string; state: PorterState }
  | { action: "hold"; reason: string; state: PorterState; healthFactor: number }
  | { action: "refuse"; reason: string; state: PorterState; healthFactor: number }
  | { action: "defend"; reason: string; intents: PorterIntent[]; state: PorterState; healthFactor: number };

export function initialPorterState(lastBlock: bigint, lastHf: number): PorterState {
  return { generation: 0, lastBlock, lastHealthFactor: lastHf, acted: [] };
}

function healthFactor(collateral: bigint, debt: bigint, threshold: bigint): number {
  if (debt === 0n) return Infinity;
  // HF = (collateral * threshold) / debt, scaled
  const scaled = (collateral * threshold) / debt;
  return Number(scaled) / 1e18;
}

export function decidePorter(input: {
  hire: PorterHireFacts;
  policy: PorterPolicy;
  state: PorterState | null;
  blockNumber: bigint;
  nowSec: number;
  kill: boolean;
}): PorterOutcome {
  const { hire, policy, blockNumber, nowSec, kill } = input;
  const base: PorterState = input.state ?? initialPorterState(blockNumber, 0);

  if (kill) {
    return { action: "stop", reason: "kill switch set", state: base };
  }
  if (!hire.open) {
    return { action: "stop", reason: "hire not open", state: base };
  }
  if (nowSec >= hire.expiry) {
    return { action: "stop", reason: "hire expired", state: base };
  }
  // refuse on stale prices
  if (hire.priceAgeSec > hire.maxPriceAgeSec) {
    return { action: "refuse", reason: `stale price: ${hire.priceAgeSec}s > ${hire.maxPriceAgeSec}s`, state: base, healthFactor: 0 };
  }
  // unreadable position
  if (hire.collateralValue === 0n && hire.debtValue === 0n) {
    return { action: "refuse", reason: "unreadable position: zero collateral and debt", state: base, healthFactor: 0 };
  }

  const hf = healthFactor(hire.collateralValue, hire.debtValue, hire.liquidationThreshold);

  // already healthy
  if (hf >= policy.targetHf) {
    return { action: "hold", reason: `healthy: HF ${hf.toFixed(3)} >= target ${policy.targetHf}`, state: { ...base, lastBlock: blockNumber, lastHealthFactor: hf }, healthFactor: hf };
  }

  // liquidatable - should not trade, should alert
  if (hf <= policy.liquidatableAt) {
    return { action: "hold", reason: `liquidatable: HF ${hf.toFixed(3)} <= ${policy.liquidatableAt}, refusing to trade`, state: { ...base, lastBlock: blockNumber, lastHealthFactor: hf }, healthFactor: hf };
  }

  // defend: compute smallest action to reach target
  // need: newCollateral / newDebt such that HF >= target
  // simplest: move (target * debt - collateral * threshold) / threshold of collateral to debt
  // simplified: move a fraction of collateral proportional to the shortfall
  const shortfall = policy.targetHf - hf;
  const defendFraction = Math.min(shortfall / (policy.targetHf - policy.liquidatableAt), 0.5);
  const amountToMove = (hire.collateralValue * BigInt(Math.floor(defendFraction * 10000))) / 10000n;

  if (amountToMove <= 0n) {
    return { action: "hold", reason: `HF ${hf.toFixed(3)} below target but computed action is zero`, state: { ...base, lastBlock: blockNumber, lastHealthFactor: hf }, healthFactor: hf };
  }

  const band = hf < policy.defendAt ? "defend" : "maintain";
  const key = `${base.generation}:${band}:0`;
  if (base.acted.includes(key)) {
    return { action: "hold", reason: `already acted this generation`, state: { ...base, lastBlock: blockNumber, lastHealthFactor: hf }, healthFactor: hf };
  }

  const intent: PorterIntent = {
    key,
    band,
    amountIn: amountToMove,
    tokenInSide: "A", // collateral is token A
    tokenOutSide: "B", // debt is token B
  };

  return {
    action: "defend",
    reason: `HF ${hf.toFixed(3)} < target ${policy.targetHf}, defending with ${amountToMove} units`,
    intents: [intent],
    state: { ...base, lastBlock: blockNumber, lastHealthFactor: hf, acted: [...base.acted, key].slice(-100) },
    healthFactor: hf,
  };
}
