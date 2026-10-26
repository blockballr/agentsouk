// durable backing for per-agent Altana sessions. Keys never leave the server;
// the sessions file is a local-dev fallback only.

import "server-only";

import postgres from "postgres";

export interface AltanaSessionRecord {
  chainId: number;
  label: string;
  tokenId: string;
  walletAddress: string;
  sessionBlob: string;
  sessionKey: string;
  adminKey?: string;
  expiry?: number;
  createdAt: string;
}

let sql: ReturnType<typeof postgres> | null = null;
let resolved = false;

function client() {
  if (!resolved) {
    resolved = true;
    sql = process.env.DATABASE_URL
      ? postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 })
      : null;
  }
  return sql;
}

let initPromise: Promise<boolean> | null = null;

function init(): Promise<boolean> {
  const c = client();
  if (!c) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Promise.race([
          c`
            create table if not exists altana_sessions (
              token_id text not null,
              chain_id integer not null,
              label text not null default '',
              wallet_address text not null,
              session_blob text not null,
              session_key text not null,
              admin_key text,
              expiry bigint,
              created_at timestamptz default now(),
              primary key (token_id, chain_id)
            )
          `,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("altana db timeout")), 4000)),
        ]);
        return true;
      } catch (e) {
        console.error("[altana] could not create altana_sessions table:", e instanceof Error ? e.message : String(e));
        initPromise = null;
        return false;
      }
    })();
  }
  return initPromise;
}

export async function loadAltanaSessionsFromDb(chainId: number): Promise<AltanaSessionRecord[]> {
  const c = client();
  if (!c) return [];
  if (!(await init())) return [];
  try {
    const rows = await c`select token_id, chain_id, label, wallet_address, session_blob, session_key, admin_key, expiry, created_at from altana_sessions where chain_id = ${chainId}`;
    const out: AltanaSessionRecord[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      if (!r.wallet_address || !r.session_blob || !r.session_key) continue;
      out.push({
        chainId: Number(r.chain_id),
        label: String(r.label ?? r.token_id),
        tokenId: String(r.token_id),
        walletAddress: String(r.wallet_address),
        sessionBlob: String(r.session_blob),
        sessionKey: String(r.session_key),
        adminKey: r.admin_key ? String(r.admin_key) : undefined,
        expiry: r.expiry != null ? Number(r.expiry) : undefined,
        createdAt: String(r.created_at ?? new Date().toISOString()),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function saveAltanaSession(rec: AltanaSessionRecord): Promise<boolean> {
  const c = client();
  if (!c) return false;
  if (!(await init())) return false;
  try {
    await c`
      insert into altana_sessions (token_id, chain_id, label, wallet_address, session_blob, session_key, admin_key, expiry, created_at)
      values (${rec.tokenId}, ${rec.chainId}, ${rec.label}, ${rec.walletAddress}, ${rec.sessionBlob}, ${rec.sessionKey}, ${rec.adminKey ?? null}, ${rec.expiry ?? null}, ${rec.createdAt})
      on conflict (token_id, chain_id) do update set
        label = excluded.label,
        wallet_address = excluded.wallet_address,
        session_blob = excluded.session_blob,
        session_key = excluded.session_key,
        admin_key = excluded.admin_key,
        expiry = excluded.expiry,
        created_at = excluded.created_at
    `;
    return true;
  } catch {
    return false;
  }
}