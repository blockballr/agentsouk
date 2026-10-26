import type { AbiEvent, PublicClient } from "viem";
import { BSC_TESTNET_CHAIN_ID } from "./types";

// a dedicated read endpoint: the shared transport is not required to serve logs
export function vaultLogEndpoint(chainId: number): string {
  if (chainId === BSC_TESTNET_CHAIN_ID) {
    return process.env.VAULT_LOG_RPC_97 ?? "https://bsc-testnet-rpc.publicnode.com";
  }
  return process.env.VAULT_LOG_RPC_56 ?? "https://bsc-rpc.publicnode.com";
}

// Public log endpoints cap the block range, so a scan walks backwards in fixed
// chunks. The calling route passes how many events it wants and how far back to look.
export const LOG_CHUNK = 50_000n;
export const MAX_LOG_CHUNKS = 12;

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
  options: { args?: Record<string, unknown>; want?: number; maxChunks?: number } = {},
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
    } catch {
      if (chunk > 2_000n) {
        chunk /= 2n;
        continue;
      }
      break;
    }
  }
  return out.slice(-want);
}
