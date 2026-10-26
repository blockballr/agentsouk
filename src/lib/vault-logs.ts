import type { AbiEvent, PublicClient } from "viem";
import { BSC_TESTNET_CHAIN_ID } from "./types";

// a dedicated read endpoint: the shared transport is not required to serve logs
export function vaultLogEndpoint(chainId: number): string {
  if (chainId === BSC_TESTNET_CHAIN_ID) {
    return process.env.VAULT_LOG_RPC_97 ?? "https://bsc-testnet-rpc.publicnode.com";
  }
  return process.env.VAULT_LOG_RPC_56 ?? "https://bsc-rpc.publicnode.com";
}

// Public log endpoints cap the block range. 3k clears BlockPI's per-call limit
// with room for its off-by-one, and a provider with a smaller cap still halves
// its way down.
export const LOG_CHUNK = 3_000n;
export const MAX_LOG_CHUNKS = 24;

export interface VaultLog {
  transactionHash: `0x${string}`;
  blockNumber: bigint | null;
  args: Record<string, unknown>;
}

export async function collectVaultLogs(
  client: PublicClient,
  vault: `0x${string}`,
  event: AbiEvent,
  head: bigint,
  options: { args?: Record<string, unknown>; want?: number; maxChunks?: number; errors?: string[] } = {},
): Promise<VaultLog[]> {
  const want = options.want ?? 200;
  const maxChunks = options.maxChunks ?? MAX_LOG_CHUNKS;
  const out: VaultLog[] = [];
  let to = head;
  // providers cap eth_getLogs ranges differently (BlockPI at 5k, others wider),
  // so a refused range halves the window instead of ending the scan
  let chunk = LOG_CHUNK;
  let chunks = 0;
  while (chunks < maxChunks && out.length < want) {
    const from = to > chunk ? to - chunk : 0n;
    try {
      const logs = await client.getLogs({
        address: vault,
        event,
        args: options.args,
        fromBlock: from,
        toBlock: to,
      } as never);
      out.unshift(...(logs as unknown as VaultLog[]));
      chunks += 1;
      if (from === 0n) break;
      to = from - 1n;
    } catch (e) {
      options.errors?.push(`${from}-${to}: ${(e as Error).message.slice(0, 120)}`);
      if (chunk > 500n) {
        chunk /= 2n;
        continue;
      }
      break;
    }
  }
  return out.slice(-want);
}
