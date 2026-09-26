// per-address mint grants: postgres when configured, in-process map for local runs

import "server-only";

export interface GrantRecord {
  address: string;
  granted: bigint;
  lastNonce: string;
  updatedAt: string;
}

const memory = new Map<string, GrantRecord>();

let tableReady: Promise<boolean> | null = null;

function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function ensureTable(sql: {
  unsafe: (q: string) => Promise<unknown>;
}): Promise<boolean> {
  if (!hasDb()) return false;
  try {
    await sql.unsafe(`
      create table if not exists mint_grants (
        address text primary key,
        granted text not null default '0',
        last_nonce text not null default '',
        updated_at timestamptz not null default now()
      );
    `);
    return true;
  } catch {
    return false;
  }
}

async function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const mod = await import("postgres");
  return mod.default(url, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

export async function readGrant(address: string): Promise<GrantRecord | null> {
  const key = address.toLowerCase();
  const cached = memory.get(key);
  if (cached) return cached;
  if (!hasDb()) return null;
  const sql = await db();
  if (tableReady === null) tableReady = ensureTable(sql as never);
  if (!(await tableReady)) {
    // no durable cap means every deploy hands each address a fresh allowance
    tableReady = null;
    throw new Error("mint grant store is unavailable");
  }
  const rows = (await sql.unsafe(
    `select address, granted, last_nonce, updated_at from mint_grants where address = $1`,
    [key],
  )) as { address: string; granted: string; last_nonce: string; updated_at: Date }[];
  if (!rows.length) return null;
  const rec: GrantRecord = {
    address: key,
    granted: BigInt(rows[0].granted),
    lastNonce: rows[0].last_nonce,
    updatedAt: rows[0].updated_at.toISOString(),
  };
  memory.set(key, rec);
  return rec;
}

export async function writeGrant(rec: GrantRecord): Promise<boolean> {
  const key = rec.address.toLowerCase();
  // only cached once the write is known to have landed, so a failed write cannot look durable
  if (!hasDb()) {
    memory.set(key, { ...rec, address: key });
    return false;
  }
  const sql = await db();
  if (tableReady === null) tableReady = ensureTable(sql as never);
  if (!(await tableReady)) {
    tableReady = null;
    throw new Error("mint grant store is unavailable");
  }
  await sql.unsafe(
    `insert into mint_grants (address, granted, last_nonce, updated_at)
     values ($1, $2, $3, now())
     on conflict (address) do update
       set granted = excluded.granted,
           last_nonce = excluded.last_nonce,
           updated_at = now()`,
    [key, rec.granted.toString(), rec.lastNonce],
  );
  memory.set(key, { ...rec, address: key });
  return true;
}

export function resetForTests(): void {
  memory.clear();
  tableReady = null;
}
