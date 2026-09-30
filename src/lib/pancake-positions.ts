import "server-only";

import { createPublicClient, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "./rpc";

// whether a wallet actually uses PancakeSwap v3: the position manager mints one token per
// liquidity position, and the farm holds the positions staked for CAKE. Addresses are from
// PancakeSwap's docs, and each farm reports the matching manager on chain (30 Sep 2026).
export const PANCAKE_POSITION_MANAGER: Record<number, `0x${string}`> = {
  56: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  97: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
};
export const PANCAKE_FARM_V3: Record<number, `0x${string}`> = {
  56: "0x556B9306565093C855AEA9AE92A594704c2Cd59e",
  97: "0x4c650FB471fe4e0f476fD3437C3411B1122c4e3B",
};

export interface PancakePositions {
  wallet: string;
  held: number;
  staked: number;
  positionManager: string;
  checkedAt: string;
}

export interface PositionReader {
  balanceOf(contract: `0x${string}`, wallet: `0x${string}`): Promise<bigint>;
}

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function viemReader(chainId: number): PositionReader {
  const client = createPublicClient({
    chain: chainId === 97 ? bscTestnet : bsc,
    transport: rpcTransport(chainId),
  }) as PublicClient;
  return {
    balanceOf: (contract, wallet) =>
      client.readContract({ address: contract, abi: BALANCE_OF, functionName: "balanceOf", args: [wallet] }),
  };
}

// a page load is the only caller, so a slow chain gives up quickly and a repeat is free
export const POSITIONS_DEADLINE_MS = 3_000;
export const POSITIONS_TTL_MS = 10 * 60_000;
// a failed read is kept as unknown for a minute, so an RPC outage costs each wallet one
// wait a minute rather than one on every page load
export const POSITIONS_FAILURE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; ttl: number; value: PancakePositions | null }>();
const pending = new Map<string, Promise<PancakePositions | null>>();

export function clearPositionsCache(): void {
  cache.clear();
  pending.clear();
}

// null when the chain is not covered or the read failed: a missing answer is never shown as zero
export async function readPancakePositions(
  chainId: number,
  wallet: string | null | undefined,
  opts: { reader?: PositionReader; deadlineMs?: number; now?: () => number } = {},
): Promise<PancakePositions | null> {
  const manager = PANCAKE_POSITION_MANAGER[chainId];
  const farm = PANCAKE_FARM_V3[chainId];
  // the zero address is an unset wallet, and the manager reverts on it
  if (!manager || !farm || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || /^0x0{40}$/.test(wallet)) return null;
  const now = opts.now ?? Date.now;
  const key = `${chainId}:${wallet.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < hit.ttl) return hit.value;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const read = readOnce(manager, farm, wallet, opts.reader ?? viemReader(chainId), opts.deadlineMs ?? POSITIONS_DEADLINE_MS, now)
    .then((value) => {
      cache.set(key, { at: now(), ttl: value ? POSITIONS_TTL_MS : POSITIONS_FAILURE_TTL_MS, value });
      return value;
    })
    .finally(() => {
      if (pending.get(key) === read) pending.delete(key);
    });
  pending.set(key, read);
  return read;
}

async function readOnce(
  manager: `0x${string}`,
  farm: `0x${string}`,
  wallet: string,
  reader: PositionReader,
  ms: number,
  now: () => number,
): Promise<PancakePositions | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [held, staked] = await Promise.race([
      Promise.all([
        reader.balanceOf(manager, wallet as `0x${string}`),
        reader.balanceOf(farm, wallet as `0x${string}`),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
    return {
      wallet,
      held: Number(held),
      staked: Number(staked),
      positionManager: manager,
      checkedAt: new Date(now()).toISOString(),
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
