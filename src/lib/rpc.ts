import "server-only";

import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  fallback,
  http,
  type Transport,
} from "viem";
import { rpcUrlsFor } from "@agora/core";
import { BSC_TESTNET_CHAIN_ID } from "./types";

// env override lives here, not in @agora/core, which is also bundled for the browser
function envOverride(chainId: number): string | undefined {
  return chainId === BSC_TESTNET_CHAIN_ID
    ? process.env.BSC_TESTNET_RPC_URL
    : process.env.BSC_MAINNET_RPC_URL;
}

// extraOverride keeps the registry route's older REGISTRY_RPC_URL working, ahead of the chain env and defaults.
export function rpcUrls(chainId: number, extraOverride?: string): string[] {
  const override = [envOverride(chainId), extraOverride].filter(Boolean).join(",");
  return rpcUrlsFor(chainId, override);
}

// viem's fallback moves to the next URL on a transport or DNS error, and rethrows only for user rejections and reverts.
export function rpcTransport(chainId: number, extraOverride?: string): Transport {
  return fallback(
    rpcUrls(chainId, extraOverride).map((url) => http(url, { timeout: 8_000 })),
    { retryCount: 0 },
  );
}

export type MinedTransaction =
  | {
      found: true;
      receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>["getTransactionReceipt"]>>;
      input: `0x${string}`;
    }
  | { found: false; asked: number; unanswered: number };

// a node that has pruned its transaction index answers a mined transaction with null, which
// the fallback takes as an answer; publicnode on testnet keeps only hours of history, so
// absence is claimed only when every endpoint says so, and an unanswered one leaves it open
export async function readMinedTransaction(
  chainId: number,
  hash: `0x${string}`,
  extraOverride?: string,
): Promise<MinedTransaction> {
  const urls = rpcUrls(chainId, extraOverride);
  let unanswered = 0;
  for (const url of urls) {
    // no retries, as in the fallback: a hung endpoint costs one timeout, not four
    const client = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 0 }) });
    try {
      const receipt = await client.getTransactionReceipt({ hash });
      const { input } = await client.getTransaction({ hash });
      return { found: true, receipt, input };
    } catch (e) {
      if (!(e instanceof TransactionReceiptNotFoundError || e instanceof TransactionNotFoundError)) unanswered++;
    }
  }
  return { found: false, asked: urls.length, unanswered };
}
