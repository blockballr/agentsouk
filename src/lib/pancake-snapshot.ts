import "server-only";

import { createPublicClient, zeroAddress, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import postgres from "postgres";
import { PANCAKE_FEE_TIERS, PANCAKE_V3_FACTORY, pancakeToken } from "./pancake";
import { PANCAKE_FARM_V3, PANCAKE_POSITION_MANAGER } from "./pancake-positions";
import { rpcTransport } from "./rpc";

// a record of PancakeSwap v3 over time, so a position chart has history when it ships:
// each run pins one block per chain and stores the WBNB/USDT pools and every position our
// agent wallet holds or has staked, raw, so any figure can be recomputed from the row

export interface PoolSnapshot {
  pool: string;
  feeTier: number;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
  feeGrowthGlobal0X128: string;
  feeGrowthGlobal1X128: string;
}

export interface PositionSnapshot {
  tokenId: string;
  wallet: string;
  staked: boolean;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
  pool: string;
  // the pool's own counters at the range edges, which the fees owed are computed from
  lowerFeeGrowthOutside0X128: string;
  lowerFeeGrowthOutside1X128: string;
  upperFeeGrowthOutside0X128: string;
  upperFeeGrowthOutside1X128: string;
}

export interface ChainSnapshot {
  chainId: number;
  blockNumber: number;
  takenAt: string;
  pools: PoolSnapshot[];
  positions: PositionSnapshot[];
}

// the agent owner wallet, which is also the payout wallet of our first-party agents
// lowercase, since a mixed-case address must carry a valid checksum or viem refuses it
export const TRACKED_WALLETS = ["0x84fedabd1b83443ad86796c15619494878b64180"];
export const SNAPSHOT_CHAINS = [97, 56];

const FACTORY_ABI = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "a", type: "address" }, { name: "b", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "", type: "address" }] },
] as const;
const POOL_ABI = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint32" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint128" }] },
  { type: "function", name: "feeGrowthGlobal0X128", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "feeGrowthGlobal1X128", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "ticks", stateMutability: "view", inputs: [{ name: "tick", type: "int24" }], outputs: [{ name: "liquidityGross", type: "uint128" }, { name: "liquidityNet", type: "int128" }, { name: "feeGrowthOutside0X128", type: "uint256" }, { name: "feeGrowthOutside1X128", type: "uint256" }, { name: "tickCumulativeOutside", type: "int56" }, { name: "secondsPerLiquidityOutsideX128", type: "uint160" }, { name: "secondsOutside", type: "uint32" }, { name: "initialized", type: "bool" }] },
] as const;
const ENUMERABLE_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "tokenOfOwnerByIndex", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
const POSITIONS_ABI = [
  { type: "function", name: "positions", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "nonce", type: "uint96" }, { name: "operator", type: "address" }, { name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidity", type: "uint128" }, { name: "feeGrowthInside0LastX128", type: "uint256" }, { name: "feeGrowthInside1LastX128", type: "uint256" }, { name: "tokensOwed0", type: "uint128" }, { name: "tokensOwed1", type: "uint128" }] },
] as const;

// a wallet with more positions than this is summarised by its first ones; ours holds a few
const MAX_POSITIONS_PER_WALLET = 20;

export async function takeChainSnapshot(chainId: number, client?: PublicClient): Promise<ChainSnapshot> {
  const c =
    client ??
    (createPublicClient({ chain: chainId === 97 ? bscTestnet : bsc, transport: rpcTransport(chainId) }) as PublicClient);
  const block = await c.getBlockNumber();
  const read = <T>(args: Parameters<PublicClient["readContract"]>[0]) =>
    c.readContract({ ...args, blockNumber: block } as Parameters<PublicClient["readContract"]>[0]) as Promise<T>;

  const wbnb = pancakeToken(chainId, "WBNB");
  const usdt = pancakeToken(chainId, "USDT");
  const pools: PoolSnapshot[] = [];
  if (wbnb && usdt) {
    const found = await Promise.all(
      PANCAKE_FEE_TIERS.map((fee) =>
        read<`0x${string}`>({ address: PANCAKE_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [wbnb.address, usdt.address, fee] }),
      ),
    );
    await Promise.all(
      found.map(async (pool, i) => {
        if (!pool || pool.toLowerCase() === zeroAddress) return;
        const [slot0, liquidity, g0, g1] = await Promise.all([
          read<readonly [bigint, number, number, number, number, number, boolean]>({ address: pool, abi: POOL_ABI, functionName: "slot0" }),
          read<bigint>({ address: pool, abi: POOL_ABI, functionName: "liquidity" }),
          read<bigint>({ address: pool, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" }),
          read<bigint>({ address: pool, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" }),
        ]);
        pools.push({
          pool,
          feeTier: PANCAKE_FEE_TIERS[i],
          sqrtPriceX96: slot0[0].toString(),
          tick: Number(slot0[1]),
          liquidity: liquidity.toString(),
          feeGrowthGlobal0X128: g0.toString(),
          feeGrowthGlobal1X128: g1.toString(),
        });
      }),
    );
  }

  const positions: PositionSnapshot[] = [];
  const manager = PANCAKE_POSITION_MANAGER[chainId];
  const farm = PANCAKE_FARM_V3[chainId];
  if (manager && farm) {
    for (const wallet of TRACKED_WALLETS) {
      for (const [holder, staked] of [[manager, false], [farm, true]] as const) {
        const count = Number(
          await read<bigint>({ address: holder, abi: ENUMERABLE_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }),
        );
        for (let i = 0; i < Math.min(count, MAX_POSITIONS_PER_WALLET); i++) {
          const tokenId = await read<bigint>({ address: holder, abi: ENUMERABLE_ABI, functionName: "tokenOfOwnerByIndex", args: [wallet as `0x${string}`, BigInt(i)] });
          const p = await read<readonly [bigint, string, `0x${string}`, `0x${string}`, number, number, number, bigint, bigint, bigint, bigint, bigint]>({
            address: manager,
            abi: POSITIONS_ABI,
            functionName: "positions",
            args: [tokenId],
          });
          const pool = await read<`0x${string}`>({ address: PANCAKE_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [p[2], p[3], p[4]] });
          const [lower, upper] = await Promise.all([
            read<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>({ address: pool, abi: POOL_ABI, functionName: "ticks", args: [p[5]] }),
            read<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>({ address: pool, abi: POOL_ABI, functionName: "ticks", args: [p[6]] }),
          ]);
          positions.push({
            tokenId: tokenId.toString(),
            wallet,
            staked,
            token0: p[2],
            token1: p[3],
            fee: Number(p[4]),
            tickLower: Number(p[5]),
            tickUpper: Number(p[6]),
            liquidity: p[7].toString(),
            feeGrowthInside0LastX128: p[8].toString(),
            feeGrowthInside1LastX128: p[9].toString(),
            tokensOwed0: p[10].toString(),
            tokensOwed1: p[11].toString(),
            pool,
            lowerFeeGrowthOutside0X128: lower[2].toString(),
            lowerFeeGrowthOutside1X128: lower[3].toString(),
            upperFeeGrowthOutside0X128: upper[2].toString(),
            upperFeeGrowthOutside1X128: upper[3].toString(),
          });
        }
      }
    }
  }
  pools.sort((a, b) => a.feeTier - b.feeTier);
  return { chainId, blockNumber: Number(block), takenAt: new Date().toISOString(), pools, positions };
}

const sql =
  process.env.DATABASE_URL && process.env.RECEIPTS_STORE === "postgres"
    ? postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 })
    : null;
let ready: Promise<void> | null = null;

function init(): Promise<void> {
  if (!sql) return Promise.resolve();
  ready ??= (async () => {
    await sql`
      create table if not exists pancake_snapshots (
        id bigserial primary key,
        chain_id integer not null,
        kind text not null,
        subject text not null,
        block_number bigint not null,
        taken_at timestamptz not null,
        payload jsonb not null
      )
    `;
    await sql`
      create index if not exists pancake_snapshots_subject_idx on pancake_snapshots (kind, subject, taken_at)
    `;
  })();
  return ready;
}

export function snapshotStoreMode(): "postgres" | "memory" {
  return sql ? "postgres" : "memory";
}

// one row per pool and per position, so a chart reads a single subject over time
export async function saveChainSnapshot(snap: ChainSnapshot): Promise<number> {
  if (!sql) return 0;
  await init();
  const rows = [
    ...snap.pools.map((p) => ({ kind: "pool", subject: p.pool.toLowerCase(), payload: p })),
    ...snap.positions.map((p) => ({ kind: "position", subject: p.tokenId, payload: p })),
  ];
  for (const r of rows) {
    await sql`
      insert into pancake_snapshots (chain_id, kind, subject, block_number, taken_at, payload)
      values (${snap.chainId}, ${r.kind}, ${r.subject}, ${snap.blockNumber}, ${snap.takenAt}, ${sql.json(JSON.parse(JSON.stringify(r.payload)))})
    `;
  }
  return rows.length;
}
