import type { VaultConfig } from "./config.js";
import type { Hire } from "./hire.js";

export const Q96 = 1n << 96n;
export const BPS = 10_000n;

export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("mulDiv by zero");
  return (a * b) / c;
}

// uniswap orders the pair by address, so this is a fact about the deployment,
// not something to read from a pool on every decision
export function aIsToken0(config: VaultConfig): boolean {
  return BigInt(config.tokenA) < BigInt(config.tokenB);
}

function isToken0(token: string, config: VaultConfig): boolean {
  const t = token.toLowerCase();
  const a = config.tokenA.toLowerCase();
  const b = config.tokenB.toLowerCase();
  if (t !== a && t !== b) throw new Error(`token ${token} is not in this vault`);
  return t === a ? aIsToken0(config) : !aIsToken0(config);
}

export function toValue0(amount: bigint, token: string, config: VaultConfig, refPriceX96: bigint): bigint {
  return isToken0(token, config) ? amount : mulDiv(amount, Q96, refPriceX96);
}

export function fromValue0(value0: bigint, token: string, config: VaultConfig, refPriceX96: bigint): bigint {
  return isToken0(token, config) ? value0 : mulDiv(value0, refPriceX96, Q96);
}

// the contract's own valuation: liquid balances plus the venue position, all at
// the price stored when the hire opened. the reference price is what makes the
// floor movable by nobody, including the agent.
export function valueInToken0(hire: Hire, config: VaultConfig): bigint {
  if (hire.refPriceX96 === 0n) return 0n;
  const a0 = aIsToken0(config);
  const heldA = a0 ? hire.balanceA : mulDiv(hire.balanceA, Q96, hire.refPriceX96);
  const liquid = a0 ? mulDiv(hire.balanceB, Q96, hire.refPriceX96) : hire.balanceB;
  const deployed = a0 ? mulDiv(hire.deployedB, Q96, hire.refPriceX96) : hire.deployedB;
  return heldA + liquid + deployed;
}

// the vault enforces two floors and the stricter one binds: the retained share
// of the deposit, and the buyer's max loss. a strategy should read this, never
// its own arithmetic, before sizing a trade.
export function floorValue(hire: Hire, config: VaultConfig): bigint {
  const retained = mulDiv(hire.depositInToken0, BigInt(config.minRetainedBps), BPS);
  const maxLoss = mulDiv(hire.depositInToken0, BPS - BigInt(hire.maxLossBps), BPS);
  return retained > maxLoss ? retained : maxLoss;
}

export function headroom(hire: Hire, config: VaultConfig): bigint {
  const value = valueInToken0(hire, config);
  const floor = floorValue(hire, config);
  return value > floor ? value - floor : 0n;
}

// the smallest amountOut that keeps the hire at or above its floor after the
// trade. passing this as minOut makes the contract revert a trade the strategy
// would not want, instead of accepting it and failing the drawdown check later.
export function minOutToKeepFloor(
  hire: Hire,
  config: VaultConfig,
  tokenIn: `0x${string}`,
  amountIn: bigint,
): bigint {
  const value = valueInToken0(hire, config);
  const floor = floorValue(hire, config);
  const valueIn = toValue0(amountIn, tokenIn, config, hire.refPriceX96);
  const slack = value > floor ? value - floor : 0n;
  const minValueOut = valueIn > slack ? valueIn - slack : 0n;
  const tokenOut = tokenIn.toLowerCase() === config.tokenA.toLowerCase() ? config.tokenB : config.tokenA;
  return fromValue0(minValueOut, tokenOut, config, hire.refPriceX96);
}

export function expiresAt(hire: Hire, nowSec: number): boolean {
  return nowSec >= hire.expiry;
}

// the agent's fee is paid on profit above the high water mark, so a strategy
// that only restores the mark earns nothing and should say so
export function profitAboveMark(hire: Hire, config: VaultConfig): bigint {
  const value = valueInToken0(hire, config);
  return value > hire.highWaterMark ? value - hire.highWaterMark : 0n;
}
