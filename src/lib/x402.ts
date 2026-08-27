// shared by client and server, mirroring the x402 v2 flow: a merchant returns
// 402 with payment requirements, the buyer previews and signs a transfer
// authorization, and a facilitator verifies then settles
// on BNB the facilitator is Binance x402 (B402), and this project ships a
// sandbox facilitator so the journey runs end to end with no credentials
// swapping in the live B402 API is a single mode change in the settle route

import { getAddress } from "viem";

export const X402_VERSION = 2;

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // eip155:56
  amount: string; // raw units (18 decimals)
  asset: string; // token contract
  payTo: string; // merchant / agent wallet
  maxTimeoutSeconds: number;
  extra: {
    name: string; // EIP-712 domain name
    version: string; // EIP-712 domain version
    assetTransferMethod: "eip3009" | "permit2";
    signerAddress?: string;
    resourceUrl?: string;
    resourceDescription?: string;
  };
}

export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentPayload {
  x402Version: number;
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
      signature: string;
    };
    resource: ResourceInfo;
  };
  resource: ResourceInfo;
  accepted: PaymentRequirements;
}

export interface PaymentOption {
  index: number;
  status: "READY_TO_SIGN" | "ACTION_REQUIRED" | "NOT_SIGNABLE";
  reasons: string[];
  assetTransferMethod: "eip3009" | "permit2";
  tokenSymbol: string;
  amount: string;
  amountUsd: number;
  payTo: string;
  needApproveFirst: boolean;
  originalAccept: PaymentRequirements;
}

export interface PreviewResult {
  paymentId: string;
  options: PaymentOption[];
  resource: ResourceInfo;
}

export interface SettleRequest {
  paymentId?: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface SettleResult {
  success: boolean;
  paymentId: string;
  txHash?: string;
  error?: string;
  details?: {
    agentId: string;
    agentName: string;
    client: string;
    payTo: string;
    amount: string;
    symbol: string;
    verified: boolean;
    mode: "sandbox" | "b402";
  };
}

export interface Receipt {
  paymentId: string;
  createdAt: string;
  txHash: string;
  mode: "sandbox" | "b402";
  agent: { chainId: number; tokenId: string; name: string };
  client: string;
  payTo: string;
  amount: string;
  symbol: string;
  activated: boolean;
  session: { spendCapUsd: number; expiresAt: string };
}

// EIP-3009 typed data (FiatToken transferWithAuthorization)

export const EIP3009_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface Eip3009Message {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

export function eip3009Domain(req: PaymentRequirements) {
  const chainId = BigInt(req.network.split(":")[1] ?? "0");
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId,
    verifyingContract: safeAddress(req.asset),
  };
}

// the registry stores token addresses lowercased, and viem rejects a
// non-checksummed address in typed-data encoding, so normalize
// (identity on the bytes)
function safeAddress(addr: string): `0x${string}` {
  try {
    return getAddress(addr);
  } catch {
    return addr as `0x${string}`;
  }
}

export function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}` as `0x${string}`;
}

// facilitation ledger (server-only store)

export interface StoredPayment extends Receipt {
  paymentPayload?: PaymentPayload;
}

// minimal in-memory ledger, reset on restart
// this is fine for the demo, and the docs state the receipt is not an on-chain
// transaction
const ledger = new Map<string, StoredPayment>();

export function recordPayment(p: StoredPayment): void {
  ledger.set(p.paymentId, p);
}

export function getPayment(paymentId: string): StoredPayment | undefined {
  return ledger.get(paymentId);
}