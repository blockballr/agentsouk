import "server-only";

import {
  verifyTypedData,
  getAddress,
} from "viem";
import {
  EIP3009_TYPES,
  Eip3009Message,
  PaymentPayload,
  PaymentRequirements,
  Receipt,
  SettleRequest,
  SettleResult,
  getPayment,
  recordPayment,
  eip3009Domain,
} from "./x402";

const SANDBOX_TX_PREFIX = "0x53a66f60094f8e2b6f97a4c7b81b4d9e77f82c9d3e6b4a1d";

function pseudoTx(paymentId: string): string {
  const hex = paymentId.replace(/-/g, "");
  return `${SANDBOX_TX_PREFIX}${hex.slice(0, 24)}`.toLowerCase();
}

function isExpired(validBefore: bigint): boolean {
  return BigInt(Math.floor(Date.now() / 1000)) > validBefore;
}

function buildMessage(req: PaymentRequirements, auth: PaymentPayload["payload"]["authorization"]): Eip3009Message {
  return {
    from: normalizeAddress(auth.from),
    to: normalizeAddress(auth.to),
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce as `0x${string}`,
  };
}

function normalizeAddress(addr: string): `0x${string}` {
  try {
    return getAddress(addr);
  } catch {
    return addr as `0x${string}`;
  }
}

export interface SettleContext {
  agent: { chainId: number; tokenId: string; name: string; symbol: string };
}

// sandbox settlement: verify the EIP-3009 signature with viem, check the terms
// match the listing, then record a receipt
// in production this is replaced by the Binance x402 verify + settle calls in
// the settle route
export async function settleSandbox(
  req: SettleRequest,
  ctx: SettleContext,
): Promise<SettleResult> {
  const pr: PaymentRequirements = req.paymentRequirements;
  const payload: PaymentPayload = req.paymentPayload;

  if (!payload || payload.x402Version !== 2) {
    return fail("Unsupported x402 version");
  }
  const auth = payload.payload?.authorization;
  if (!auth?.signature) return fail("Missing signature");

  if (payload.accepted.amount !== pr.amount || payload.accepted.payTo !== pr.payTo) {
    return fail("Signed terms do not match payment requirements");
  }

  const domain = eip3009Domain(pr);
  const message = buildMessage(pr, auth);

  if (isExpired(message.validBefore)) return fail("Authorization expired");
  if (message.value <= 0n) return fail("Non-positive value");

  const ok = await verifyTypedData({
    address: message.from,
    domain,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
    signature: auth.signature as `0x${string}`,
  }).catch(() => false);

  if (!ok) return fail("Signature verification failed");

  const paymentId = req.paymentId ?? crypto.randomUUID();
  const now = new Date();
  const receipt: Receipt = {
    paymentId,
    createdAt: now.toISOString(),
    txHash: pseudoTx(paymentId),
    mode: "sandbox",
    agent: {
      chainId: ctx.agent.chainId,
      tokenId: ctx.agent.tokenId,
      name: ctx.agent.name,
    },
    client: auth.from,
    payTo: pr.payTo,
    amount: pr.amount,
    symbol: ctx.agent.symbol,
    activated: true,
    session: {
      spendCapUsd: 10,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    },
  };

  recordPayment({ ...receipt, paymentPayload: payload });

  return {
    success: true,
    paymentId,
    txHash: receipt.txHash,
    details: {
      agentId: ctx.agent.tokenId,
      agentName: ctx.agent.name,
      client: auth.from,
      payTo: pr.payTo,
      amount: pr.amount,
      symbol: ctx.agent.symbol,
      verified: true,
      mode: "sandbox",
    },
  };
}

export function getSandboxReceipt(paymentId: string): Receipt | undefined {
  return getPayment(paymentId);
}

function fail(error: string): SettleResult {
  return { success: false, paymentId: "", error };
}