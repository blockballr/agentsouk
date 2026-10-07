import "server-only";

import {
  verifyTypedData,
  getAddress,
  hashTypedData,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { SESSION_HOURS, SESSION_SPEND_CAP_USD } from "@agora/core";
import { verifySmartWalletSignature } from "./erc1271";
import { escrowTermsFor, fundEscrow, issueSettlementReceipt } from "./escrow";
import {
  BSC_TESTNET_CHAIN_ID,
  explorerBaseFor,
  settlementAsset,
  targetChainId,
  type SettlementAsset,
} from "./types";
import {
  EIP3009_TYPES,
  Eip3009Message,
  PaymentPayload,
  PaymentRequirements,
  Receipt,
  SettleRequest,
  SettleResult,
  eip3009Domain,
} from "./x402";
import { recordPaymentDurable, getPaymentDurable } from "./receipts-store";
import { rpcTransport } from "./rpc";

const SANDBOX_TX_PREFIX = "0x53a66f60094f8e2b6f97a4c7b81b4d9e77f82c9d3e6b4a1d";



// chain and RPC per chain id, so nothing in the settlement path is pinned to
// mainnet: the relay used to broadcast to chain 56 whatever the client signed
function chainConfig(chainId: number) {
  const chain = chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
  return { chain, transport: rpcTransport(chainId) };
}

function chainIdFromNetwork(network: string): number | null {
  const parsed = Number.parseInt(network.split(":")[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pseudoTx(paymentId: string): string {
  const hex = paymentId.replace(/-/g, "");
  return `${SANDBOX_TX_PREFIX}${hex.slice(0, 24)}`.toLowerCase();
}

// EIP-3009 validAfter/validBefore are checked on-chain against block.timestamp, so the
// facilitator must judge them against chain time, not the host clock
async function chainNow(): Promise<bigint> {
  try {
    const { chain, transport } = chainConfig(targetChainId());
    const client = createPublicClient({ chain, transport });
    const block = await client.getBlock({ blockTag: "latest" });
    if (block?.timestamp) return block.timestamp;
  } catch {
    // RPC unavailable: fall back to the host clock
  }
  return BigInt(Math.floor(Date.now() / 1000));
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
  // no symbol here: a receipt records the pinned asset's own, not a label the caller sends
  agent: { chainId: number; tokenId: string; name: string };
}

// opt-in smart wallet (ERC-1271) verification; default off so the mainnet
// behavior is unchanged until the token layer supports settlement
function isSmartWalletVerifyEnabled(): boolean {
  return process.env.SMART_WALLET_VERIFY === "on";
}

// shared verification for sandbox and prod settlement: validate the payload shape, the
// signed terms, and the EIP-3009 signature before anything is recorded or broadcast
async function settleSandboxChecks(
  req: SettleRequest,
): Promise<{
  ok: true;
  auth: PaymentPayload["payload"]["authorization"];
  message: Eip3009Message;
  erc1271: boolean;
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

  // bind what was actually signed to the payment requirements: the accepted block alone is
  // client-controlled framing, so the signed value and recipient must equal the requirements
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

  const nowChain = await chainNow();
  if (nowChain > message.validBefore) return { ok: false, error: "Authorization expired" };
  if (message.validAfter > nowChain) {
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

  if (!ok) {
    if (!isSmartWalletVerifyEnabled()) {
      return { ok: false, error: "Signature verification failed" };
    }
    // opt-in path: ecrecover failed and the signer may be a smart account, so validate on-chain
    // via ERC-1271 against our own typed-data hash; fail closed
    const verdict = await verifySmartWalletSignature({
      from: message.from,
      signature: auth.signature,
      hash: hashTypedData({
        domain,
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
      }),
      transport: chainConfig(targetChainId()).transport,
    });
    if (!verdict.isContract) return { ok: false, error: "Signature verification failed" };
    if (!verdict.valid) return { ok: false, error: "Smart wallet signature verification failed" };
    return { ok: true, auth, message, erc1271: true };
  }
  return { ok: true, auth, message, erc1271: false };
}

// sandbox settlement: verify the EIP-3009 signature with viem, check the terms match the
// listing, then record a receipt (in production the Binance x402 verify + settle calls replace this)
export async function settleSandbox(
  req: SettleRequest,
  ctx: SettleContext,
): Promise<SettleResult> {
  const checks = await settleSandboxChecks(req);
  if (!checks.ok) return fail(checks.error);

  const pr: PaymentRequirements = req.paymentRequirements;
  const auth = checks.auth;

  // mirror the prod asset pin: the signed chain must have a configured asset and
  // the offered asset must be it, so a self-signed authorization over an
  // arbitrary token cannot activate a receipt
  const signedChainId = chainIdFromNetwork(pr.network);
  if (signedChainId === null) {
    return fail(`Unrecognised payment network ${pr.network}`);
  }
  let asset: SettlementAsset;
  try {
    asset = settlementAsset(signedChainId);
  } catch {
    return fail("Unsupported settlement asset");
  }
  if (normalizeAddress(pr.asset) !== normalizeAddress(asset.address)) {
    return fail("Unsupported settlement asset");
  }

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
    payTo: pr.extra?.agentPayTo ?? pr.payTo,
    amount: pr.amount,
    symbol: asset.symbol,
    activated: true,
    session: {
      spendCapUsd: SESSION_SPEND_CAP_USD,
      expiresAt: new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString(),
    },
  };
  await recordPaymentDurable({ ...receipt, paymentPayload: req.paymentPayload });

  return {
    success: true,
    paymentId,
    txHash: receipt.txHash,
    details: {
      agentId: ctx.agent.tokenId,
      agentName: ctx.agent.name,
      client: auth.from,
      payTo: pr.extra?.agentPayTo ?? pr.payTo,
      amount: pr.amount,
      symbol: asset.symbol,
      verified: true,
      mode: "sandbox",
    },
  };
}

export async function getSandboxReceipt(
  paymentId: string,
): Promise<Receipt | undefined> {
  return getPaymentDurable(paymentId);
}

// prod settlement: relay the buyer's EIP-3009 authorization on BNB Chain mainnet; the relay
// pays gas, no buyer key is ever held, and the 5 U cap is enforced before any broadcast
const PROD_CAP_RAW = 5n * 10n ** 18n; // 5 units, 18 decimals

// Prod settlement replay guard. The in-process set only covers one instance, so
// a restart or a second replica could relay the same signed authorization again;
// when the durable store is configured the nonce is also claimed in a small
// table. The on-chain nonce stays authoritative, so an unreachable store falls
// back to the local set rather than blocking settlement.
const seenProdNonces = new Set<string>();
const SEEN_PROD_NONCES_MAX = 10_000;

type NonceSql = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
};

let nonceClient: Promise<NonceSql | null> | null = null;
let nonceTableReady: Promise<boolean> | null = null;

function nonceStoreConfigured(): boolean {
  return process.env.RECEIPTS_STORE === "postgres" && !!process.env.DATABASE_URL;
}

async function nonceDb(): Promise<NonceSql | null> {
  if (!nonceStoreConfigured()) return null;
  if (!nonceClient) {
    nonceClient = (async () => {
      try {
        const mod = (await import("postgres")) as unknown as {
          default: (url: string, opts?: object) => unknown;
        };
        return mod.default(process.env.DATABASE_URL as string, {
          max: 1,
          idle_timeout: 20,
          connect_timeout: 5,
        }) as NonceSql;
      } catch {
        return null;
      }
    })();
  }
  return nonceClient;
}

async function ensureNonceTable(sql: NonceSql): Promise<boolean> {
  if (nonceTableReady === null) {
    nonceTableReady = (async () => {
      try {
        await sql.unsafe(`
          create table if not exists settlement_nonces (
            nonce text primary key,
            seen_at timestamptz not null default now()
          );
        `);
        return true;
      } catch {
        nonceTableReady = null;
        return false;
      }
    })();
  }
  return nonceTableReady;
}

function rememberProdNonce(nonce: string): void {
  if (seenProdNonces.size >= SEEN_PROD_NONCES_MAX) seenProdNonces.clear();
  seenProdNonces.add(nonce);
}

// Claims the nonce in the durable store when configured and in memory always;
// returns false on a replay. A configured store that cannot be reached falls
// back to the local set: the chain rejects a reused nonce anyway, so refusing
// here would turn a store blip into a settlement outage.
// two instances settling at once can read the same pending relay nonce, and the
// loser is refused before anything is spent, so it reads the nonce again and resends
// a resend cannot pay twice: the buyer's authorization is single use on chain
const NONCE_CLASH = /nonce too low|replacement transaction underpriced|nonce has already been used/i;

export async function sendWithNonceRetry(
  send: () => Promise<`0x${string}`>,
  retries = 3,
  pauseMs = 150,
): Promise<`0x${string}`> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (attempt >= retries || !NONCE_CLASH.test(text)) throw e;
      await new Promise((r) => setTimeout(r, pauseMs * (attempt + 1) + Math.random() * pauseMs));
    }
  }
}

export async function claimProdNonce(nonce: string): Promise<boolean> {
  if (seenProdNonces.has(nonce)) return false;
  const sql = await nonceDb();
  if (sql) {
    try {
      if (await ensureNonceTable(sql)) {
        const rows = (await sql.unsafe(
          `insert into settlement_nonces (nonce) values ($1)
           on conflict (nonce) do nothing
           returning nonce`,
          [nonce],
        )) as unknown[];
        if (rows.length === 0) {
          rememberProdNonce(nonce);
          return false;
        }
      }
    } catch {
      // store unavailable: the local guard below still applies
    }
  }
  rememberProdNonce(nonce);
  return true;
}

export function resetProdNoncesForTests(): void {
  seenProdNonces.clear();
  nonceClient = null;
  nonceTableReady = null;
}

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

  // fail closed before spending relay gas: an ERC-1271 signature is not recoverable ECDSA, so
  // splitSig would produce garbage v/r/s and the transfer would revert
  if (checks.erc1271) {
    return fail(
      "Smart wallet settlement is not supported for this asset: the token's transferWithAuthorization cannot consume ERC-1271 signatures",
    );
  }

  if (checks.message.value > PROD_CAP_RAW) {
    return fail("Amount exceeds the 5 U prod cap");
  }

  // the chain the client signed for must be the chain this deployment is configured for,
  // else a testnet payload could be relayed to mainnet or the reverse
  const signedChainId = chainIdFromNetwork(pr.network);
  if (signedChainId === null) {
    return fail(`Unrecognised payment network ${pr.network}`);
  }
  if (signedChainId !== targetChainId()) {
    return fail(
      `Authorization is for chain ${signedChainId} but this deployment settles on chain ${targetChainId()}`,
    );
  }
  const { chain, transport } = chainConfig(signedChainId);
  const asset = settlementAsset(signedChainId);

  if (normalizeAddress(pr.asset) !== normalizeAddress(asset.address)) {
    return fail("Unsupported settlement asset");
  }

  if (!(await claimProdNonce(auth.nonce))) {
    return fail("Authorization already submitted");
  }

  const relay = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: relay,
    chain,
    transport,
  });

  try {
    // escrowed or direct: which path this settlement takes is decided by the signed
    // recipient, re-checked here against the configured funder rather than trusted
    // from the request. The payment id is needed before anything broadcasts, because
    // it is the job id both contracts are keyed by
    const terms = escrowTermsFor(pr.payTo, pr.extra?.agentPayTo);
    const paymentId = req.paymentId ?? crypto.randomUUID();
    let hash: `0x${string}`;

    if (terms) {
      // one transaction: the token validates the buyer's authorization inside the
      // funder, funds land in escrow, and the agent's wallet is the payTo the
      // release path pays. The relay cannot move the funds anywhere else
      hash = await fundEscrow({
        paymentId,
        token: getAddress(asset.address),
        buyer: getAddress(auth.from),
        agentPayTo: terms.agentPayTo,
        value: checks.message.value,
        validAfter: checks.message.validAfter,
        validBefore: checks.message.validBefore,
        nonce: checks.message.nonce,
        signature: auth.signature as `0x${string}`,
      });
      // the ledger record follows the escrow: same payment id, claimable once.
      // Best effort, so a ledger outage leaves a warning rather than a paid hire
      // with no receipt
      await issueSettlementReceipt({
        paymentId,
        buyer: getAddress(auth.from),
        agentPayTo: terms.agentPayTo,
        token: getAddress(asset.address),
        amount: checks.message.value,
        nonce: checks.message.nonce,
      });
    } else {
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

    hash = await sendWithNonceRetry(() =>
      walletClient.sendTransaction({
        to: asset.address,
        data,
      }),
    );
    // race: if this wait times out but the tx still lands on-chain, funds
    // moved with no receipt recorded
    const onchain = await publicClient.waitForTransactionReceipt({ hash });
    if (onchain.status !== "success") return fail(`Relay tx reverted: ${hash}`);
    }

    // the receipt records who the money is for: on an escrowed hire that is the
    // agent's wallet, so the by-payee read still answers for the agent even though
    // the signed recipient was the funder holding it
    const payee = terms ? terms.agentPayTo : pr.payTo;
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
      payTo: payee,
      amount: pr.amount,
      symbol: asset.symbol,
      activated: true,
      session: {
        spendCapUsd: SESSION_SPEND_CAP_USD,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    };
    await recordPaymentDurable({ ...receipt, paymentPayload: req.paymentPayload });

    return {
      success: true,
      paymentId,
      txHash: hash,
      details: {
        agentId: ctx.agent.tokenId,
        agentName: ctx.agent.name,
        client: auth.from,
        payTo: payee,
        amount: pr.amount,
        symbol: asset.symbol,
        verified: true,
        mode: "prod",
        // chain-aware explorer, so a chain-97 receipt does not link to mainnet
        txLink: `${explorerBaseFor(targetChainId())}/tx/${hash}`,
      },
    };
  } catch (e) {
    return fail((e as Error).message);
  }
}

function fail(error: string): SettleResult {
  return { success: false, paymentId: "", error };
}