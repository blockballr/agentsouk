import "server-only";

import { createPublicClient, zeroAddress, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "./rpc";
import {
  PANCAKE_FEE_TIERS,
  PANCAKE_V3_FACTORY,
  isUsdQuote,
  pancakeToken,
  priceFromSqrt,
  sortsFirst,
  supportedPairs,
} from "./pancake";

// read-only view calls against PancakeSwap v3, all pinned to one block so the price,
// tick and pool in an answer describe the same moment. A read sits inside a paid
// delivery, so it has one deadline and a short cache rather than open-ended retries.

export interface PoolQuote {
  chainId: number;
  pair: string;
  pool: `0x${string}`;
  feeTier: number;
  tick: number;
  liquidity: string;
  price: number;
  blockNumber: number;
}

export interface PoolReader {
  blockNumber(): Promise<bigint>;
  getPool(tokenA: `0x${string}`, tokenB: `0x${string}`, fee: number, block: bigint): Promise<`0x${string}`>;
  liquidity(pool: `0x${string}`, block: bigint): Promise<bigint>;
  slot0(pool: `0x${string}`, block: bigint): Promise<{ sqrtPriceX96: bigint; tick: number }>;
}

// well inside the marketplace's 20 second delivery wait, with room for the planning after
export const READ_DEADLINE_MS = 6_000;
export const QUOTE_TTL_MS = 15_000;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

// PancakeSwap's slot0 widens feeProtocol to uint32, unlike Uniswap's uint8
const POOL_ABI = [
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

export function viemPoolReader(chainId: number): PoolReader {
  const client = createPublicClient({
    chain: chainId === 97 ? bscTestnet : bsc,
    transport: rpcTransport(chainId),
  }) as PublicClient;
  return {
    blockNumber: () => client.getBlockNumber(),
    getPool: (tokenA, tokenB, fee, block) =>
      client.readContract({
        address: PANCAKE_V3_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [tokenA, tokenB, fee],
        blockNumber: block,
      }),
    liquidity: (pool, block) =>
      client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity", blockNumber: block }),
    slot0: async (pool, block) => {
      const s = await client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0", blockNumber: block });
      return { sqrtPriceX96: s[0], tick: s[1] };
    },
  };
}

// one answer per pair and tier for a few seconds, so a burst of requests costs one read
const cache = new Map<string, { at: number; quote: PoolQuote }>();

export function clearPancakeCache(): void {
  cache.clear();
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} seconds`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// the named fee tier, or else the tier holding the most liquidity; an empty pool has no price
export async function readPancakePrice(
  chainId: number,
  base: string,
  quote: string,
  opts: { feeTier?: number; reader?: PoolReader; deadlineMs?: number; now?: () => number } = {},
): Promise<PoolQuote | { error: string }> {
  const b = pancakeToken(chainId, base);
  const q = pancakeToken(chainId, quote);
  if (!b || !q || !isUsdQuote(q.symbol)) {
    return { error: `${base}/${quote} is not a supported PancakeSwap pair; use ${supportedPairs(chainId).join(" or ")}` };
  }
  if (opts.feeTier !== undefined && !PANCAKE_FEE_TIERS.includes(opts.feeTier as (typeof PANCAKE_FEE_TIERS)[number])) {
    return { error: `feeTier must be one of ${PANCAKE_FEE_TIERS.join(", ")}` };
  }
  const now = opts.now ?? Date.now;
  const key = `${chainId}:${b.symbol}/${q.symbol}:${opts.feeTier ?? "deepest"}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < QUOTE_TTL_MS) return hit.quote;

  const reader = opts.reader ?? viemPoolReader(chainId);
  const tiers = opts.feeTier !== undefined ? [opts.feeTier] : [...PANCAKE_FEE_TIERS];
  try {
    const result = await withDeadline(
      (async () => {
        const block = await reader.blockNumber();
        const pools = await Promise.all(tiers.map((fee) => reader.getPool(b.address, q.address, fee, block)));
        const live = tiers
          .map((fee, i) => ({ fee, pool: pools[i] }))
          .filter((p) => p.pool && p.pool.toLowerCase() !== zeroAddress);
        const depths = await Promise.all(live.map((p) => reader.liquidity(p.pool, block)));
        let chosen: { pool: `0x${string}`; fee: number; liquidity: bigint } | null = null;
        for (let i = 0; i < live.length; i++) {
          const liquidity = depths[i];
          if (liquidity > BigInt(0) && (!chosen || liquidity > chosen.liquidity)) chosen = { ...live[i], liquidity };
        }
        if (!chosen) return null;
        const { sqrtPriceX96, tick } = await reader.slot0(chosen.pool, block);
        return { chosen, block, sqrtPriceX96, tick };
      })(),
      opts.deadlineMs ?? READ_DEADLINE_MS,
    );
    if (!result) return { error: `No PancakeSwap v3 ${b.symbol}/${q.symbol} pool with liquidity on chain ${chainId}` };
    const baseIsToken0 = sortsFirst(b.address, q.address);
    const [d0, d1] = baseIsToken0 ? [b.decimals, q.decimals] : [q.decimals, b.decimals];
    const answer: PoolQuote = {
      chainId,
      pair: `${b.symbol}/${q.symbol}`,
      pool: result.chosen.pool,
      feeTier: result.chosen.fee,
      tick: result.tick,
      liquidity: result.chosen.liquidity.toString(),
      price: priceFromSqrt(result.sqrtPriceX96, d0, d1, baseIsToken0),
      blockNumber: Number(result.block),
    };
    cache.set(key, { at: now(), quote: answer });
    return answer;
  } catch (e) {
    return { error: `Could not read PancakeSwap on chain ${chainId}: ${(e as Error).message.split("\n")[0]}` };
  }
}
