// minimal EIP-1193 client: connect, ensure BNB chain, sign EIP-3009 typed data
// deliberately dependency-free; MetaMask, Binance Wallet and Rabby all expose
// window.ethereum

import { TRANSFER_TYPES } from '@agora/core'

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    BinanceChain?: Eip1193Provider;
  }
}

export const BSC_CHAIN_ID_HEX = "0x38";

const BSC_CHAIN_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

export class WalletUnavailableError extends Error {
  constructor() {
    super("No wallet found. Install MetaMask or Binance Wallet to hire agents.");
  }
}

export function getProvider(): Eip1193Provider {
  const provider = typeof window !== "undefined" ? window.ethereum ?? window.BinanceChain : undefined;
  if (!provider) throw new WalletUnavailableError();
  return provider;
}

export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("No account authorized.");
  return accounts[0];
}

// returns the active chain id after switching if needed
export async function ensureBscChain(): Promise<string> {
  const provider = getProvider();
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === BSC_CHAIN_ID_HEX) return current;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [BSC_CHAIN_PARAMS],
    });
  }
  return (await provider.request({ method: "eth_chainId" })) as string;
}

export async function signTransferAuthorization(
  address: string,
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  },
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  },
): Promise<string> {
  const provider = getProvider();
  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [
      address,
      JSON.stringify({
        domain,
        primaryType: "TransferWithAuthorization",
        types: TRANSFER_TYPES,
        message,
      }),
    ],
  })) as string;
  return signature;
}
