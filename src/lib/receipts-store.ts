// server-only durable receipts store behind RECEIPTS_STORE=postgres
// memory stays the fallback whenever the flag or DATABASE_URL is missing
// this module must only be imported from server code (it pulls in a node
// driver); it wraps the in-memory ledger in x402.ts as a write-through cache

import "server-only";
import postgres from "postgres";
import {
  recordPayment,
  getPayment,
  type StoredPayment,
} from "./x402";

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
