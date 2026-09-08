import "server-only";

import {
  verifyTypedData,
  getAddress,
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
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

// shared verification for sandbox and prod settlement: validate the payload
// shape, the signed terms, and the EIP-3009 signature itself before anything
// is recorded or broadcast
async function settleSandboxChecks(
  req: SettleRequest,
): Promise<{
  ok: true;
  auth: PaymentPayload["payload"]["authorization"];
  message: Eip3009Message;
} | { ok: false; error: string }> {
  const pr: PaymentRequirements = req.paymentRequirements;
  const payload: PaymentPayload = req.paymentPayload;

  if (!payload || payload.x402Version !== 2) {
    return { ok: false, error: "Unsupported x402 version" };
  }
  const auth = payload.payload?.authorization;
  if (!auth?.signature) return { ok: false, error: "Missing signature" };

  if (payload.accepted.amount !== pr.amount || payload.accepted.payTo !== pr.payTo) {
    return { ok: false, error: "Signed terms do not match payment requirements" };
  }

  // bind what was actually signed to the payment requirements: the accepted
  // block alone is client-controlled framing, so the signed value and
  // recipient must equal the requirements before anything is recorded or spent
  let message: Eip3009Message;
  try {
    if (BigInt(auth.value) !== BigInt(pr.amount)) {
      return { ok: false, error: "Signed value does not match payment requirements" };
    }
    if (normalizeAddress(auth.to) !== normalizeAddress(pr.payTo)) {
      return { ok: false, error: "Signed recipient does not match payment requirements" };
    }
    message = buildMessage(pr, auth);
  } catch {
    return { ok: false, error: "Malformed authorization payload" };
  }

  if (isExpired(message.validBefore)) return { ok: false, error: "Authorization expired" };
  if (message.validAfter > BigInt(Math.floor(Date.now() / 1000))) {
    return { ok: false, error: "Authorization not yet valid" };
  }
  if (message.value <= 0n) return { ok: false, error: "Non-positive value" };

  const domain = eip3009Domain(pr);
  const ok = await verifyTypedData({
    address: message.from,
    domain,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
    signature: auth.signature as `0x${string}`,
  }).catch(() => false);

  if (!ok) return { ok: false, error: "Signature verification failed" };
  return { ok: true, auth, message };
}

// sandbox settlement: verify the EIP-3009 signature with viem, check the terms
// match the listing, then record a receipt
// in production this is replaced by the Binance x402 verify + settle calls in
// the settle route
export async function settleSandbox(
  req: SettleRequest,
  ctx: SettleContext,
): Promise<SettleResult> {
  const checks = await settleSandboxChecks(req);
  if (!checks.ok) return fail(checks.error);

  const pr: PaymentRequirements = req.paymentRequirements;
  const auth = checks.auth;

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

  recordPayment({ ...receipt, paymentPayload: req.paymentPayload });

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

// prod settlement: relay the buyer's EIP-3009 authorization on BNB Chain
// mainnet. the relay wallet pays gas; the buyer signs only, and no buyer key
// is ever held. the 5 USDC cap is enforced before any broadcast.
const PROD_CAP_RAW = 5n * 10n ** 18n; // 5 USDC, 18 decimals
const USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_RPC = "https://bsc-dataseed.binance.org";

// per-process, bounded in-memory replay guard: a restart clears it and other
// replicas do not share it — griefing mitigation only, not consensus
const seenProdNonces = new Set<string>();

// split a 65-byte ECDSA signature into r, s and a normalized v (27/28)
function splitSig(sig: `0x${string}`) {
  const s = sig.slice(2);
  const r = `0x${s.slice(0, 64)}` as `0x${string}`;
  const vs = `0x${s.slice(64, 128)}` as `0x${string}`;
  let vNum = parseInt(s.slice(128, 130), 16);
  if (vNum < 27) vNum += 27;
  return { r, vs, vNum };
}

export async function settleProd(
  req: SettleRequest,
  ctx: SettleContext,
): Promise<SettleResult> {
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) return fail("prod mode requires RELAY_PRIVATE_KEY");

  const pr: PaymentRequirements = req.paymentRequirements;

  // run the same verification as sandbox before spending anything; the helper
  // also binds the signed value/recipient to the payment requirements
  const checks = await settleSandboxChecks(req);
  if (!checks.ok) return fail(checks.error);
  const auth = checks.auth;

  if (checks.message.value > PROD_CAP_RAW) {
    return fail("Amount exceeds the 5 USDC prod cap");
  }

  // only broadcast USDC on BSC: the EIP-3009 domain is verified against the
  // client-supplied pr.asset, and a mismatched contract would revert on-chain
  // and burn relay gas
  if (normalizeAddress(pr.asset) !== normalizeAddress(USDC_BSC)) {
    return fail("Unsupported settlement asset");
  }

  if (seenProdNonces.has(auth.nonce)) {
    return fail("Authorization already submitted");
  }

  const relay = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });
  const walletClient = createWalletClient({
    account: relay,
    chain: bsc,
    transport: http(BSC_RPC),
  });

  try {
    seenProdNonces.add(auth.nonce);
    const { r, vs, vNum } = splitSig(auth.signature as `0x${string}`);
    const data = encodeFunctionData({
    abi: [
      {
        name: "transferWithAuthorization",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        outputs: [],
      },
    ],
    args: [
      getAddress(auth.from),
      getAddress(auth.to),
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce as `0x${string}`,
      vNum,
      r,
      vs,
    ],
    });

    const hash = await walletClient.sendTransaction({
      to: USDC_BSC as `0x${string}`,
      data,
    });
    // race: if this wait times out but the tx still lands on-chain, funds
    // moved with no receipt recorded
    const onchain = await publicClient.waitForTransactionReceipt({ hash });
    if (onchain.status !== "success") return fail(`Relay tx reverted: ${hash}`);

    const paymentId = req.paymentId ?? crypto.randomUUID();
    const now = new Date();
    const receipt: Receipt = {
      paymentId,
      createdAt: now.toISOString(),
      txHash: hash,
      mode: "prod",
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
        spendCapUsd: 5,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    };
    recordPayment({ ...receipt, paymentPayload: req.paymentPayload });

    return {
      success: true,
      paymentId,
      txHash: hash,
      details: {
        agentId: ctx.agent.tokenId,
        agentName: ctx.agent.name,
        client: auth.from,
        payTo: pr.payTo,
        amount: pr.amount,
        symbol: ctx.agent.symbol,
        verified: true,
        mode: "prod",
        txLink: `https://bscscan.com/tx/${hash}`,
      },
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

function fail(error: string): SettleResult {
  return { success: false, paymentId: "", error };
}