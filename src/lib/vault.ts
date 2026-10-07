import "server-only";

import { encodeFunctionData } from "viem";
import { BSC_TESTNET_CHAIN_ID } from "./types";

// the vault side of the split: what may move. The deposit sits in the vault
// contract on chain 97; the executor's job is only to trade an open hire inside
// the bounds the contract set at open. Chain 56 lands after the outside review
// clears, so the table below carries 97 alone on purpose.

export const VAULT_BY_CHAIN: Record<number, string> = {
  [BSC_TESTNET_CHAIN_ID]: "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8",
};

export function vaultFor(chainId: number): string | null {
  return VAULT_BY_CHAIN[chainId] ?? null;
}

export const VAULT_ABI = [
  { name: "trade", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
] as const;

export const VAULT_READ_ABI = [
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [
    { name: "buyer", type: "address" }, { name: "agent", type: "address" },
    { name: "expiry", type: "uint64" }, { name: "maxSlippageBps", type: "uint16" },
    { name: "open", type: "bool" }, { name: "balanceA", type: "uint256" },
    { name: "balanceB", type: "uint256" }, { name: "refPriceX96", type: "uint160" },
    { name: "fee", type: "uint24" }, { name: "depositInToken0", type: "uint256" },
  ] },
  { name: "hiresFor", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ name: "", type: "uint256[]" }] },
] as const;

export interface HireView {
  id: bigint;
  buyer: string;
  agent: string;
  expiry: number;
  maxSlippageBps: number;
  open: boolean;
  balanceA: bigint;
  balanceB: bigint;
  refPriceX96: bigint;
  fee: number;
}

// the token the hire counts as untraded: whichever side still holds the balance
export function tradeTokenIn(h: HireView): "A" | "B" | null {
  if (!h.open || Date.now() / 1000 >= h.expiry) return null;
  if (h.balanceA > 0n) return "A";
  if (h.balanceB > 0n) return "B";
  return null;
}

export function tradeIntent(h: HireView, tokenA: string, tokenB: string) {
  const side = tradeTokenIn(h);
  if (!side) return null;
  // minOut stays zero on purpose: the contract computes the buyer's floor from
  // the stored reference price, and only the contract bounds the trade
  return {
    id: h.id,
    tokenIn: side === "A" ? tokenA : tokenB,
    amountIn: side === "A" ? h.balanceA : h.balanceB,
    minOut: 0n,
    calldata: encodeFunctionData({
      abi: VAULT_ABI,
      functionName: "trade",
      args: [h.id, side === "A" ? (tokenA as `0x${string}`) : (tokenB as `0x${string}`), side === "A" ? h.balanceA : h.balanceB, 0n],
    }),
  };
}
