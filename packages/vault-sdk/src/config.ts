import type { PublicClient } from "viem";
import { VAULT_READ_ABI } from "./abi.js";

// the deployments this SDK ships knowing. a builder running against their own
// vault passes the address instead of relying on this table. both entries move
// with each deploy, so the address is always the argument that wins.
export const DEPLOYMENTS: Record<number, `0x${string}`> = {
  56: "0xf3dfb43d7bdccbe8d612c712dcca148884fc68ec",
  97: "0xb3293b75aad92d5f66a852357dd93c34cf96893b",
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): `0x${string}` {
  if (!ADDRESS.test(value)) throw new Error(`not an address: ${value}`);
  return value as `0x${string}`;
}

export function vaultAddressFor(chainId: number, override?: string): `0x${string}` {
  if (override) return isAddress(override);
  const known = DEPLOYMENTS[chainId];
  if (!known) throw new Error(`no vault known on chain ${chainId}. pass vault explicitly.`);
  return known;
}

export interface VaultConfig {
  address: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  router: `0x${string}`;
  factory: `0x${string}`;
  capA: bigint;
  capB: bigint;
  // the share of the deposit the contract refuses to release, in basis points
  minRetainedBps: number;
  // the smallest deposit the vault accepts, valued in token0 at the open price
  minDepositInToken0: bigint;
  // live hires one buyer may hold at once, so an agent can size its queue
  maxOpenPerBuyer: number;
}

const cache = new Map<string, VaultConfig>();

// the vault's immutables never change for an address, so one read is enough for
// the life of the process. an agent deciding every block should not pay for it.
export async function readVaultConfig(client: PublicClient, vault: `0x${string}`): Promise<VaultConfig> {
  const key = vault.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const base = { address: vault, abi: VAULT_READ_ABI } as const;
  const [tokenA, tokenB, router, factory, capA, capB, retained, minDeposit, maxOpen] = await Promise.all([
    client.readContract({ ...base, functionName: "tokenA" }),
    client.readContract({ ...base, functionName: "tokenB" }),
    client.readContract({ ...base, functionName: "router" }),
    client.readContract({ ...base, functionName: "factory" }),
    client.readContract({ ...base, functionName: "capA" }),
    client.readContract({ ...base, functionName: "capB" }),
    client.readContract({ ...base, functionName: "minRetainedBps" }),
    client.readContract({ ...base, functionName: "minDepositInToken0" }),
    client.readContract({ ...base, functionName: "MAX_OPEN_PER_BUYER" }),
  ]);

  const config: VaultConfig = {
    address: vault,
    tokenA,
    tokenB,
    router,
    factory,
    capA,
    capB,
    minRetainedBps: Number(retained),
    minDepositInToken0: minDeposit,
    maxOpenPerBuyer: Number(maxOpen),
  };
  cache.set(key, config);
  return config;
}
