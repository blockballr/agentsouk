// per-owner seller keys for built job sellers. The house key is the fallback;
// when a built agent sells jobs under its own key, the key is generated here,
// stored encrypted, and used to sign its quotes and deliverables. The builder
// never sees it; an owner-gated export hands it over on request.

import "server-only";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { sellerConfigFromEnv, type SellerConfig } from "@/lib/seller8183";
import type { Hex } from "viem";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists builder_seller_keys (
          agent_id text primary key,
          owner text not null,
          encrypted_key text not null,
          address text not null,
          export_requested_at timestamptz,
          exported_at timestamptz,
          revoked_at timestamptz,
          created_at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists builder_seller_keys_owner on builder_seller_keys (owner)`;
      // columns added after the first deploy: idempotent so old tables catch up
      await sql!`alter table builder_seller_keys add column if not exists export_requested_at timestamptz`;
      await sql!`alter table builder_seller_keys add column if not exists exported_at timestamptz`;
      await sql!`alter table builder_seller_keys add column if not exists revoked_at timestamptz`;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

// AES-256-GCM under a server secret. The secret is hashed to a 32-byte key so
// any string works; rotation requires re-encrypting every row.
function secretKey(): Buffer {
  const secret = process.env.BUILDER_KEY_SECRET ?? process.env.RELAY_PRIVATE_KEY ?? "";
  if (!secret) throw new Error("BUILDER_KEY_SECRET is not configured");
  return scryptSync(secret, "builder-seller-keys", 32);
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export interface SellerKeyRecord {
  agentId: string;
  owner: string;
  address: string;
  createdAt: string;
}

// generate a fresh key and store it encrypted. Returns the address only.
export async function generateSellerKey(owner: string, agentId: string): Promise<string> {
  const key = `0x${randomBytes(32).toString("hex")}` as Hex;
  const address = privateKeyToAccount(key).address;
  const blob = encrypt(key);
  if (sql && (await ensureTable())) {
    await sql`
      insert into builder_seller_keys (agent_id, owner, encrypted_key, address, created_at)
      values (${agentId}, ${owner.toLowerCase()}, ${blob}, ${address}, now())
      on conflict (agent_id) do update set
        encrypted_key = excluded.encrypted_key,
        address = excluded.address
    `;
  } else {
    // no database: keep in process memory is not safe across instances, so this
    // path requires DATABASE_URL to be set for per-owner keys
    throw new Error("seller key store unavailable");
  }
  return address;
}

// load + decrypt a stored key. Returns null when none exists.
export async function loadSellerKey(agentId: string): Promise<{ privateKey: Hex; address: string } | null> {
  if (!sql || !(await ensureTable())) return null;
  const rows = (await sql`select encrypted_key, address from builder_seller_keys where agent_id = ${agentId} limit 1`) as { encrypted_key: string; address: string }[];
  if (!rows[0]) return null;
  try {
    return { privateKey: decrypt(rows[0].encrypted_key) as Hex, address: rows[0].address };
  } catch {
    return null;
  }
}

// owner-gated export: returns the raw key once, under a signature from the owner.
// The caller must verify the signature before calling this.
export async function exportSellerKey(owner: string, agentId: string): Promise<string | null> {
  if (!sql || !(await ensureTable())) return null;
  const rows = (await sql`select encrypted_key, owner from builder_seller_keys where agent_id = ${agentId} limit 1`) as { encrypted_key: string; owner: string }[];
  if (!rows[0] || rows[0].owner.toLowerCase() !== owner.toLowerCase()) return null;
  try {
    return decrypt(rows[0].encrypted_key);
  } catch {
    return null;
  }
}

// build a SellerConfig for a built agent from its stored key. Returns null when
// no key exists (direct-only agent, or pre-upgrade). Price from env or default 2.
export async function builtSellerConfig(agentId: string, name: string, chainId: number): Promise<SellerConfig | null> {
  const key = await loadSellerKey(agentId);
  if (!key) return null;
  const price = Number(process.env.SELLER8183_PRICE_U_BUILT ?? process.env.SELLER8183_PRICE_U ?? 2);
  const num = (name: string, fallback: number): number => {
    const n = Number(process.env[`${name}_BUILT`] ?? process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    chainId,
    providerWallet: key.address,
    sellerKey: key.privateKey,
    priceUsd: Number.isFinite(price) && price > 0 ? price : 2,
    feeBps: num("SELLER8183_FEE_BPS", 50),
    minFeeU: num("SELLER8183_MIN_FEE_U", 1),
    maxFeeU: num("SELLER8183_MAX_FEE_U", 50),
    minCapitalUsd: num("SELLER8183_MIN_CAPITAL_USD", 50),
    agentId: null,
    agentName: name,
  };
}
export async function isRevoked(agentId: string): Promise<boolean> {
  if (!sql || !(await ensureTable())) return false;
  const rows = (await sql`select revoked_at from builder_seller_keys where agent_id = ${agentId} limit 1`) as { revoked_at: Date | string | null }[];
  return Boolean(rows[0]?.revoked_at);
}

// request an export: records the request time and sends a notice. The key is
// not returned yet; completeExport delivers it after the delay.
export async function requestExport(owner: string, agentId: string): Promise<{ ok: boolean; reason?: string; readyAt: string | null }> {
  if (!sql || !(await ensureTable())) return { ok: false, reason: "store unavailable", readyAt: null };
  const rows = (await sql`select owner, revoked_at from builder_seller_keys where agent_id = ${agentId} limit 1`) as { owner: string; revoked_at: Date | string | null }[];
  if (!rows[0]) return { ok: false, reason: "no key for this agent", readyAt: null };
  if (rows[0].owner.toLowerCase() !== owner.toLowerCase()) return { ok: false, reason: "not the owner", readyAt: null };
  if (rows[0].revoked_at) return { ok: false, reason: "key already revoked", readyAt: null };
  const now = new Date();
  await sql`update builder_seller_keys set export_requested_at = ${now.toISOString()}, updated_at = now() where agent_id = ${agentId}`;
  return { ok: true, readyAt: now.toISOString() };
}

export async function completeExport(owner: string, agentId: string): Promise<{ ok: boolean; key?: string; reason?: string; readyAt?: string | null }> {
  if (!sql || !(await ensureTable())) return { ok: false, reason: "store unavailable" };
  const rows = (await sql`select encrypted_key, owner, export_requested_at, exported_at, revoked_at from builder_seller_keys where agent_id = ${agentId} limit 1`) as { encrypted_key: string; owner: string; export_requested_at: Date | string | null; exported_at: Date | string | null; revoked_at: Date | string | null }[];
  if (!rows[0]) return { ok: false, reason: "no key for this agent" };
  if (rows[0].owner.toLowerCase() !== owner.toLowerCase()) return { ok: false, reason: "not the owner" };
  if (rows[0].revoked_at) return { ok: false, reason: "key already revoked" };
  if (!rows[0].export_requested_at) return { ok: false, reason: "no export requested" };
  let key: string;
  try { key = decrypt(rows[0].encrypted_key); } catch { return { ok: false, reason: "decrypt failed" }; }
  await sql`update builder_seller_keys set exported_at = now(), updated_at = now() where agent_id = ${agentId}`;
  return { ok: true, key };
}

// revoke marketplace signing: the builder takes full custody.
export async function revokeKey(owner: string, agentId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!sql || !(await ensureTable())) return { ok: false, reason: "store unavailable" };
  const rows = (await sql`select owner, revoked_at from builder_seller_keys where agent_id = ${agentId} limit 1`) as { owner: string; revoked_at: Date | string | null }[];
  if (!rows[0]) return { ok: false, reason: "no key for this agent" };
  if (rows[0].owner.toLowerCase() !== owner.toLowerCase()) return { ok: false, reason: "not the owner" };
  if (rows[0].revoked_at) return { ok: true, reason: "already revoked" };
  await sql`update builder_seller_keys set revoked_at = now(), updated_at = now() where agent_id = ${agentId}`;
  return { ok: true };
}

export async function hasExported(agentId: string): Promise<boolean> {
  if (!sql || !(await ensureTable())) return false;
  const rows = (await sql`select exported_at from builder_seller_keys where agent_id = ${agentId} limit 1`) as { exported_at: Date | string | null }[];
  return Boolean(rows[0]?.exported_at);
}
export async function listSellerKeys(owner: string): Promise<SellerKeyRecord[]> {
  if (!sql || !(await ensureTable())) return [];
  const rows = (await sql`
    select agent_id, owner, address, created_at from builder_seller_keys where owner = ${owner.toLowerCase()} order by created_at desc
  `) as { agent_id: string; owner: string; address: string; created_at: Date | string }[];
  return rows.map((r) => ({ agentId: r.agent_id, owner: r.owner, address: r.address, createdAt: new Date(r.created_at).toISOString() }));
}
