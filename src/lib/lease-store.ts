// A per-buyer lease, so two watchers that overlap cannot both repay the same
// position or draw the same fee. An external clock and a scheduled run can
// collide; the daily cap alone still allows two repays inside the same minute.
// With a database the lease is one atomic upsert, so the loser is decided by the
// row lock rather than by timing.

import "server-only";
import postgres from "postgres";

export interface LeaseStore {
  acquire(key: string, holder: string, ttlMs: number, now?: number): Promise<boolean>;
  release(key: string, holder: string): Promise<void>;
}

// one vocabulary for the two families of work: the health watch holds a buyer,
// the vault sweeps hold a hire. The scope is in the key so the two can never
// collide in the one table.
export const HEALTH_LEASE_TTL_MS = 5 * 60_000;
export const VAULT_LEASE_TTL_MS = 25 * 60_000;

export function healthLeaseKey(buyer: string): string {
  return `health:${buyer.toLowerCase()}`;
}

export function vaultLeaseKey(chainId: number, hireId: string): string {
  return `vault:${chainId}:${hireId}`;
}

// The in-process store stands in where there is no database. It only orders
// callers inside one instance, which is the common collision; a deployment with
// several instances needs the table below.
export function memoryLeaseStore(): LeaseStore {
  const held = new Map<string, { holder: string; expiresAt: number }>();
  return {
    async acquire(key, holder, ttlMs, now = Date.now()) {
      const current = held.get(key);
      if (current && current.expiresAt > now && current.holder !== holder) return false;
      held.set(key, { holder, expiresAt: now + ttlMs });
      return true;
    },
    async release(key, holder) {
      if (held.get(key)?.holder === holder) held.delete(key);
    },
  };
}

const processStore = memoryLeaseStore();

function postgresLeaseStore(databaseUrl: string): LeaseStore {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  let ready: Promise<boolean> | null = null;

  function ensure(): Promise<boolean> {
    if (ready) return ready;
    ready = (async () => {
      try {
        await sql`
          create table if not exists job_leases (
            key text primary key,
            holder text not null,
            expires_at timestamptz not null
          )
        `;
        return true;
      } catch {
        ready = null;
        return false;
      }
    })();
    return ready;
  }

  return {
    async acquire(key, holder, ttlMs, now = Date.now()) {
      if (!(await ensure())) {
        return processStore.acquire(key, holder, ttlMs, now);
      }
      try {
        const rows = await sql`
          insert into job_leases (key, holder, expires_at)
          values (${key}, ${holder}, ${new Date(now + ttlMs)})
          on conflict (key) do update
            set holder = excluded.holder, expires_at = excluded.expires_at
            where job_leases.expires_at <= now() or job_leases.holder = excluded.holder
          returning key
        `;
        return rows.length > 0;
      } catch {
        // a database outage must not stop the defence; the chain's daily cap is
        // still the hard bound, and the in-process lease covers the common case
        return processStore.acquire(key, holder, ttlMs, now);
      }
    },
    async release(key, holder) {
      if (!(await ensure())) {
        await processStore.release(key, holder);
        return;
      }
      try {
        await sql`delete from job_leases where key = ${key} and holder = ${holder}`;
      } catch {
        // the lease expires on its own; a failed release only shortens the wait
      }
    },
  };
}

let shared: LeaseStore | null = null;

export function defaultLeaseStore(): LeaseStore {
  if (!shared) {
    shared = process.env.DATABASE_URL ? postgresLeaseStore(process.env.DATABASE_URL) : processStore;
  }
  return shared;
}
