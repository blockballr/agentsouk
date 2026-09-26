import "server-only";

import { fallback, http, type Transport } from "viem";
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
