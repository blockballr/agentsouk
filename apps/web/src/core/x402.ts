// client-side half of the x402 flow, mirroring src/lib/x402.ts on the server:
// fetch payment requirements, preview, sign an EIP-3009 transfer authorization
// in the wallet, then hand the payload to the settle endpoint
// no viem here on purpose; the server checksums addresses and owns verification

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

// wallet-facing typed data: EIP712Domain is included EXPLICITLY because
// wallets (MetaMask/Rabby) derive an EMPTY domain type when it is omitted,
// which diverges from what viem/ethers auto-insert on verification — the
// resulting digest differs and the recovered signer never matches. Declaring
// it makes every implementation (wallet + viem + ethers) hash identically.
export const TRANSFER_TYPES = {
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

export interface TransferMessage {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export function x402ChainId(req: PaymentRequirements): number {
  return Number.parseInt(req.network.split(":")[1] ?? "0", 10);
}

export function x402Domain(req: PaymentRequirements) {
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId: x402ChainId(req),
    verifyingContract: req.asset,
  };
}

export function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}` as `0x${string}`;
}
