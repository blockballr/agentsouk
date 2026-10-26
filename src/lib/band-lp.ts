import "server-only";

import { createPublicClient, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "./rpc";
import { PANCAKE_POSITION_MANAGER } from "./pancake-positions";
import { PANCAKE_V3_FACTORY } from "./pancake";

// PancakeSwap V3 NonfungiblePositionManager ABI for the four operations
// the Band Keeper needs. Addresses are from pancake-positions.ts.
export const NFPM_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "token0", type: "address" },
        { name: "token1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "amount0Desired", type: "uint256" },
        { name: "amount1Desired", type: "uint256" },
        { name: "amount0Min", type: "uint256" },
        { name: "amount1Min", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "increaseLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenId", type: "uint256" },
        { name: "amount0Desired", type: "uint256" },
        { name: "amount1Desired", type: "uint256" },
        { name: "amount0Min", type: "uint256" },
        { name: "amount1Min", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    }],
    outputs: [
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "decreaseLiquidity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenId", type: "uint256" },
        { name: "liquidity", type: "uint128" },
        { name: "amount0Min", type: "uint256" },
        { name: "amount1Min", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "collect",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenId", type: "uint256" },
        { name: "recipient", type: "address" },
        { name: "amount0Max", type: "uint128" },
        { name: "amount1Max", type: "uint128" },
      ],
    }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    name: "positions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint256" },
      { name: "tokensOwed1", type: "uint256" },
    ],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tokenOfOwnerByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface LpPosition {
  tokenId: bigint;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

export function positionManager(chainId: number): string | null {
  return PANCAKE_POSITION_MANAGER[chainId] ?? null;
}

// Read all positions owned by a wallet on the position manager
export async function readPositions(
  client: PublicClient,
  chainId: number,
  owner: string,
): Promise<LpPosition[]> {
  const pm = positionManager(chainId);
  if (!pm) return [];
  const count = await client.readContract({
    address: pm as `0x${string}`,
    abi: NFPM_ABI,
    functionName: "balanceOf",
    args: [owner as `0x${string}`],
  }) as bigint;
  const positions: LpPosition[] = [];
  for (let i = 0n; i < count; i++) {
    const tokenId = await client.readContract({
      address: pm as `0x${string}`,
      abi: NFPM_ABI,
      functionName: "tokenOfOwnerByIndex",
      args: [owner as `0x${string}`, i],
    }) as bigint;
    const pos = await client.readContract({
      address: pm as `0x${string}`,
      abi: NFPM_ABI,
      functionName: "positions",
      args: [tokenId],
    }) as readonly unknown[];
    positions.push({
      tokenId,
      token0: String(pos[2]),
      token1: String(pos[3]),
      fee: Number(pos[4]),
      tickLower: Number(pos[5]),
      tickUpper: Number(pos[6]),
      liquidity: pos[7] as bigint,
      tokensOwed0: pos[10] as bigint,
      tokensOwed1: pos[11] as bigint,
    });
  }
  return positions;
}

// Tick math helpers for v3 ranges
// Convert a price to a tick (simplified, for common fee tiers)
export function priceToTick(price: number, token0Decimals: number, token1Decimals: number): number {
  const adjustedPrice = price * 10 ** (token0Decimals - token1Decimals);
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

export function tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  return Math.pow(1.0001, tick) * 10 ** (token1Decimals - token0Decimals);
}

// Round a tick to the nearest valid tick for a given fee tier
export function roundTick(tick: number, fee: number): number {
  const spacing = fee === 100 ? 1 : fee === 500 ? 10 : fee === 2500 ? 50 : 200;
  return Math.round(tick / spacing) * spacing;
}

// Build mint params for a new position
export function buildMintParams(input: {
  token0: string;
  token1: string;
  fee: number;
  priceLower: number;
  priceUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  recipient: string;
  token0Decimals: number;
  token1Decimals: number;
  slippageBps: number;
}): {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
  deadline: bigint;
} {
  const tickLower = roundTick(priceToTick(input.priceLower, input.token0Decimals, input.token1Decimals), input.fee);
  const tickUpper = roundTick(priceToTick(input.priceUpper, input.token0Decimals, input.token1Decimals), input.fee);
  const slippage = BigInt(10000 - input.slippageBps);
  return {
    token0: input.token0,
    token1: input.token1,
    fee: input.fee,
    tickLower: Math.min(tickLower, tickUpper),
    tickUpper: Math.max(tickLower, tickUpper),
    amount0Desired: input.amount0Desired,
    amount1Desired: input.amount1Desired,
    amount0Min: (input.amount0Desired * slippage) / 10000n,
    amount1Min: (input.amount1Desired * slippage) / 10000n,
    recipient: input.recipient,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  };
}
