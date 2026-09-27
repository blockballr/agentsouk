// server-only durable receipts store behind RECEIPTS_STORE=postgres; memory stays the fallback without the flag or DATABASE_URL.
// Only import from server code (it pulls in a node driver); wraps the in-memory ledger in x402.ts as a write-through cache.

import "server-only";
import postgres from "postgres";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import {
  recordPayment,
  getPayment,
  listPayments,
  type StoredPayment,
} from "./x402";
import { BSC_TESTNET_CHAIN_ID, settlementAsset } from "./types";
import { rpcTransport } from "./rpc";

const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20 })
  : null;

let initPromise: Promise<boolean> | null = null;

function postgresEnabled(): boolean {
  return process.env.RECEIPTS_STORE === "postgres" && !!sql;
}

export function receiptsMode(): "postgres" | "memory" {
  return postgresEnabled() ? "postgres" : "memory";
}

function init(): Promise<boolean> {
  if (!postgresEnabled() || !sql) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await sql!`
          create table if not exists receipts (
            payment_id text primary key,
            payload jsonb not null,
            created_at timestamptz default now()
          )
        `;
        return true;
      } catch {
        initPromise = null;
        return false;
      }
    })();
  }
  return initPromise;
}

// best-effort upsert; false on any failure (memory cache still holds it)
export async function saveReceipt(stored: StoredPayment): Promise<boolean> {
  if (!(await init()) || !sql) return false;
  try {
    await sql`
      insert into receipts (payment_id, payload)
      values (${stored.paymentId}, ${sql.json(stored as never)})
      on conflict (payment_id) do update set payload = excluded.payload
    `;
    return true;
  } catch {
    return false;
  }
}

// best-effort read-through; undefined on any failure
export async function loadReceipt(
  paymentId: string,
): Promise<StoredPayment | undefined> {
  if (!(await init()) || !sql) return undefined;
  try {
    const rows = await sql`
      select payload from receipts where payment_id = ${paymentId} limit 1
    `;
    const payload = rows[0]?.payload;
    return payload ? (payload as StoredPayment) : undefined;
  } catch {
    return undefined;
  }
}

// write-through: cache in memory immediately, then persist (awaited by callers)
export async function recordPaymentDurable(p: StoredPayment): Promise<void> {
  recordPayment(p);
  await saveReceipt(p);
}

// Lists every receipt belonging to a client wallet, newest first, from the durable store:
// the in-process ledger only knows about payments made by the same instance, so it is empty for most serverless requests.
export async function listPaymentsByClient(
  client: string,
  limit = 200,
): Promise<StoredPayment[]> {
  const cached = listPayments().filter(
    (p) => (p.client ?? "").toLowerCase() === client.toLowerCase(),
  );
  if (postgresEnabled() && sql && (await init())) {
    try {
      const rows = await sql`
        select payload from receipts
        where lower(payload->>'client') = ${client.toLowerCase()}
        order by created_at desc
        limit ${limit}
      `;
      const stored = rows.map((r) => r.payload as StoredPayment);
      for (const p of stored) recordPayment(p);
      return stored;
    } catch {
      // fall through to whatever the memory cache holds
    }
  }
  return cached;
}

// Lists every receipt paid to a wallet, newest first, from the durable store: the
// income side of the same rows listPaymentsByClient reads for a payer. The payTo is
// the agent's receiving wallet, so a lister asking "did anyone hire me" reads here.
export async function listPaymentsByPayee(
  payee: string,
  limit = 200,
): Promise<StoredPayment[]> {
  const cached = listPayments().filter(
    (p) => (p.payTo ?? "").toLowerCase() === payee.toLowerCase(),
  );
  if (postgresEnabled() && sql && (await init())) {
    try {
      const rows = await sql`
        select payload from receipts
        where lower(payload->>'payTo') = ${payee.toLowerCase()}
        order by created_at desc
        limit ${limit}
      `;
      const stored = rows.map((r) => r.payload as StoredPayment);
      for (const p of stored) recordPayment(p);
      return stored;
    } catch {
      // fall through to whatever the memory cache holds
    }
  }
  return cached;
}

// read-through: memory cache first, then postgres (backfilling the cache)
export async function getPaymentDurable(
  paymentId: string,
): Promise<StoredPayment | undefined> {
  const cached = getPayment(paymentId);
  if (cached) return cached;
  const stored = await loadReceipt(paymentId);
  if (stored) recordPayment(stored);
  return stored;
}

export async function revokeSessionDurable(paymentId: string): Promise<boolean> {
  const cached = getPayment(paymentId);
  const stored = cached ?? (await loadReceipt(paymentId));
  if (!stored) return false;
  const next = { ...stored, activated: false };
  recordPayment(next);
  await saveReceipt(next);
  return true;
}

// The relay cancels the buyer's EIP-3009 nonce on the settlement token so the signed
// authorization cannot be spent after the session is revoked. The deployed token's
// cancelAuthorization is permissionless and takes the authorizer and nonce only
// (selector 0xe4e94023), so no buyer key or signature is needed here.
const CANCEL_AUTHORIZATION_ABI = [
  {
    name: "cancelAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const AUTHORIZATION_STATE_ABI = [
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface CancellationPlan {
  chainId: number;
  asset: `0x${string}`;
  authorizer: `0x${string}`;
  nonce: `0x${string}`;
}

export type CancellationPlanResult =
  | { ok: true; plan: CancellationPlan }
  | { ok: false; reason: string };

export type CancelOutcome =
  | { kind: "success"; hash: `0x${string}` }
  | { kind: "already-revoked" }
  | { kind: "failed"; error: string };

export interface AuthorizationCancelResult {
  attempted: boolean;
  canceled: boolean;
  alreadyRevoked?: boolean;
  txHash?: `0x${string}`;
  chainId?: number;
  error?: string;
}

// Decide whether a stored payment carries an EIP-3009 authorization worth cancelling
// on chain. Pure: no RPC and no key lookup, so it is safe to unit test.
export function planAuthorizationCancel(
  stored: StoredPayment,
): CancellationPlanResult {
  const payload = stored.paymentPayload;
  const auth = payload?.payload?.authorization;
  if (!auth) return { ok: false, reason: "no stored authorization" };
  const authorizer = (auth.from ?? "").trim();
  const nonce = (auth.nonce ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(authorizer)) {
    return { ok: false, reason: "authorization has no authorizer" };
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    return { ok: false, reason: "authorization has no nonce" };
  }
  const network = payload?.accepted?.network ?? "";
  const chainId = Number.parseInt(network.split(":")[1] ?? "", 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return { ok: false, reason: "authorization has no chain" };
  }
  let asset: string;
  try {
    asset = settlementAsset(chainId).address;
  } catch {
    return { ok: false, reason: `no settlement asset for chain ${chainId}` };
  }
  // the same asset pin the facilitator applies, so we never cancel against an arbitrary token
  const signedAsset = (payload?.accepted?.asset ?? "").toLowerCase();
  if (signedAsset !== asset.toLowerCase()) {
    return { ok: false, reason: "authorization asset is not the settlement asset" };
  }
  return {
    ok: true,
    plan: {
      chainId,
      asset: asset as `0x${string}`,
      authorizer: authorizer as `0x${string}`,
      nonce: nonce as `0x${string}`,
    },
  };
}

export function cancellationResultFromOutcome(
  outcome: CancelOutcome,
  chainId: number,
): AuthorizationCancelResult {
  if (outcome.kind === "success") {
    return { attempted: true, canceled: true, txHash: outcome.hash, chainId };
  }
  if (outcome.kind === "already-revoked") {
    return { attempted: false, canceled: true, alreadyRevoked: true, chainId };
  }
  return { attempted: true, canceled: false, error: outcome.error, chainId };
}

export type CancelBroadcast = (plan: CancellationPlan) => Promise<CancelOutcome>;

// Relay the cancellation and await the receipt. A missing relay key is reported,
// never hidden: the caller still has the ledger revoke.
async function broadcastAuthorizationCancel(
  plan: CancellationPlan,
): Promise<CancelOutcome> {
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) {
    return {
      kind: "failed",
      error: "relay key absent, authorization not cancelled on chain",
    };
  }
  try {
    const chain = plan.chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
    const transport = rpcTransport(plan.chainId);
    const account = privateKeyToAccount(key as `0x${string}`);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });
    // if the token exposes authorizationState, a nonce already used or cancelled needs
    // no second transaction; a token without the getter falls through to the tx
    try {
      const used = await publicClient.readContract({
        address: plan.asset,
        abi: AUTHORIZATION_STATE_ABI,
        functionName: "authorizationState",
        args: [plan.authorizer, plan.nonce],
      });
      if (used) return { kind: "already-revoked" };
    } catch {
      // no getter on this token; let the cancel transaction decide
    }
    const data = encodeFunctionData({
      abi: CANCEL_AUTHORIZATION_ABI,
      functionName: "cancelAuthorization",
      args: [plan.authorizer, plan.nonce],
    });
    const hash = await walletClient.sendTransaction({ to: plan.asset, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { kind: "failed", error: `cancel authorization reverted: ${hash}` };
    }
    return { kind: "success", hash };
  } catch (e) {
    return { kind: "failed", error: (e as Error).message };
  }
}

// Cancel the stored authorization on chain. Never throws: any failure is returned so
// the caller can report the ledger and the chain separately.
export async function cancelAuthorization(
  stored: StoredPayment,
  broadcast: CancelBroadcast = broadcastAuthorizationCancel,
): Promise<AuthorizationCancelResult> {
  const planned = planAuthorizationCancel(stored);
  if (!planned.ok) {
    return { attempted: false, canceled: false, error: planned.reason };
  }
  try {
    const outcome = await broadcast(planned.plan);
    return cancellationResultFromOutcome(outcome, planned.plan.chainId);
  } catch (e) {
    return {
      attempted: true,
      canceled: false,
      chainId: planned.plan.chainId,
      error: (e as Error).message,
    };
  }
}

// Read-through variant for the API route; never throws.
export async function cancelAuthorizationDurable(
  paymentId: string,
  broadcast: CancelBroadcast = broadcastAuthorizationCancel,
): Promise<AuthorizationCancelResult> {
  const stored = await getPaymentDurable(paymentId);
  if (!stored) {
    return { attempted: false, canceled: false, error: "unknown paymentId" };
  }
  return cancelAuthorization(stored, broadcast);
}
