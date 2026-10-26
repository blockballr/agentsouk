// server-only durable backing for per-wallet profiles (username + avatar).
// degrades to no-op without DATABASE_URL, matching shelf-store's posture.

import "server-only";

import postgres from "postgres";

export interface ProfileRow {
  wallet: string;
  username: string;
  avatar: string;
  updatedAt: string;
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
            create table if not exists profiles (
              wallet text primary key,
              username text not null default '',
              avatar text not null default '',
              updated_at timestamptz default now()
            )
          `,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("profile db timeout")), 4000)),
        ]);
        return true;
      } catch (e) {
        console.error("[profile] could not create profiles table:", e instanceof Error ? e.message : String(e));
        initPromise = null;
        return false;
      }
    })();
  }
  return initPromise;
}

export async function loadProfile(wallet: string): Promise<ProfileRow | null> {
  const c = client();
  if (!c) return null;
  if (!(await init())) return null;
  try {
    const rows = await c`select wallet, username, avatar, updated_at from profiles where wallet = ${wallet.toLowerCase()}`;
    if (rows.length === 0) return null;
    const r = rows[0] as { wallet: string; username: string; avatar: string; updated_at: string };
    return { wallet: r.wallet, username: r.username, avatar: r.avatar, updatedAt: r.updated_at };
  } catch {
    return null;
  }
}

export async function saveProfile(wallet: string, username: string, avatar: string): Promise<ProfileRow | null> {
  const c = client();
  if (!c) return null;
  if (!(await init())) return null;
  try {
    const rows = await c`
      insert into profiles (wallet, username, avatar, updated_at)
      values (${wallet.toLowerCase()}, ${username}, ${avatar}, now())
      on conflict (wallet) do update set username = excluded.username, avatar = excluded.avatar, updated_at = now()
      returning wallet, username, avatar, updated_at
    `;
    const r = rows[0] as { wallet: string; username: string; avatar: string; updated_at: string };
    return { wallet: r.wallet, username: r.username, avatar: r.avatar, updatedAt: r.updated_at };
  } catch {
    return null;
  }
}