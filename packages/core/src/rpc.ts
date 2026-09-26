// RPC endpoints in one place, so the wallet and the server cannot drift.

const BSC_MAINNET_CHAIN_ID = 56;
const BSC_TESTNET_CHAIN_ID = 97;

const DEFAULT_RPC_URLS: Record<number, readonly string[]> = {
  [BSC_MAINNET_CHAIN_ID]: [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed1.defibit.io",
  ],
  [BSC_TESTNET_CHAIN_ID]: [
    "https://bsc-testnet-rpc.publicnode.com",
    "https://bsc-testnet.bnbchain.org",
    "https://bsc-testnet.drpc.org",
  ],
};

// A comma separated override goes first, with the verified defaults behind it as a safety net.
export function rpcUrlsFor(chainId: number, override?: string): string[] {
  const defaults = DEFAULT_RPC_URLS[chainId] ?? DEFAULT_RPC_URLS[BSC_MAINNET_CHAIN_ID];
  const overridden = (override ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return [...new Set([...overridden, ...defaults])];
}
