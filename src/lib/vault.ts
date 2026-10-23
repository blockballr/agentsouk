import "server-only";

import { encodeFunctionData } from "viem";
import { BSC_CHAIN_ID, BSC_TESTNET_CHAIN_ID } from "./types";

// the vault side of the split: what may move. The deposit sits in the vault
// contract on chain 97 or chain 56; the executor's job is only to trade an open
// hire inside the bounds the contract set at open.
export const VAULT_BY_CHAIN: Record<number, string> = {
  [BSC_TESTNET_CHAIN_ID]: process.env.VAULT_ADDRESS_97 ?? "0xe1cd584d0bf2dbba90f84d5ac991984cae8f9d74",
  [BSC_CHAIN_ID]: process.env.VAULT_ADDRESS_56 ?? "0x028129c230123a46f4305ce0d2b29f8ac5255149",
};

export function vaultFor(chainId: number): string | null {
  return VAULT_BY_CHAIN[chainId] ?? null;
}

export const VAULT_ABI = [
  { name: "trade", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "supplyToVenue", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "venue", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdrawFromVenue", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "venue", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
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
  { name: "tokenA", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "tokenB", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "valueInToken0", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
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
  depositInToken0: bigint;
}

// one layer intent becomes one call at the vault; minOut stays zero on purpose:
// the contract computes the buyer's floor from the stored reference price, and
// only the contract bounds the trade
export function tradeCallFor(id: bigint, tokenIn: string, amountIn: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: VAULT_ABI,
    functionName: "trade",
    args: [id, tokenIn as `0x${string}`, amountIn, 0n],
  }) as `0x${string}`;
}

