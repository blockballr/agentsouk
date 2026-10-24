import { fromValue0, toValue0, type Strategy } from "@agentsouk/vault-sdk";

// A target-weight policy, which is the smallest honest example: it needs no
// price feed because the vault already values the hire at the reference stored
// at open. Sell the overweight side back toward the target when drift leaves
// the band. A grid or a momentum policy would read a pool price and return the
// same Decision shape.

const TARGET = Number(process.env.TARGET_WEIGHT_A ?? "0.5");
const BAND = Number(process.env.DRIFT_BAND ?? "0.05");
const MIN_TRADE_USD = Number(process.env.MIN_TRADE_USD ?? "1");

const BPS = 10_000n;
const targetBps = BigInt(Math.round(Math.min(Math.max(TARGET, 0), 1) * Number(BPS)));

export const targetWeight: Strategy = ({ config, hire, value, floor }) => {
  if (value <= floor) {
    return { action: "skip", reason: "value is at or below the floor" };
  }
  if (hire.refPriceX96 === 0n) {
    return { action: "skip", reason: "the hire carries no reference price" };
  }

  const valueA = toValue0(hire.balanceA, config.tokenA, config, hire.refPriceX96);
  const weightA = Number(valueA) / Number(value);
  const drift = weightA - TARGET;
  if (Math.abs(drift) < BAND) {
    return { action: "skip", reason: `inside the band at ${(weightA * 100).toFixed(1)}% A` };
  }

  // half the drift back toward target, never the whole position
  const targetValueA = (value * targetBps) / BPS;
  const moveValue0 = (valueA > targetValueA ? valueA - targetValueA : targetValueA - valueA) / 2n;
  const tokenIn = valueA > targetValueA ? config.tokenA : config.tokenB;
  const balance = valueA > targetValueA ? hire.balanceA : hire.balanceB;

  // token0 is the quote on the live pairs, so its 18 decimals make one unit of
  // value one USD. this is a floor on dust, not a risk control.
  const minValue0 = BigInt(Math.round(Math.max(MIN_TRADE_USD, 0) * 1e18));
  if (moveValue0 < minValue0) {
    return { action: "skip", reason: "the drift is too small to pay for itself" };
  }

  const sized = fromValue0(moveValue0, tokenIn, config, hire.refPriceX96);
  const amountIn = sized > balance ? balance : sized;
  if (amountIn === 0n) {
    return { action: "skip", reason: "the side to trade is empty" };
  }

  return {
    action: "trade",
    tokenIn,
    amountIn,
    note: `drift ${(drift * 100).toFixed(1)} points, moving half of it back to ${(TARGET * 100).toFixed(0)}% A`,
  };
};
