import "server-only";

import postgres from "postgres";
import type { StrategyState } from "./grid-strategy";

// The layer's cache and its lease: one row per hire, and a lease so two runners
// cannot decide the same hire at once. Nothing here outranks the chain; it is
// the same cache the layer treats every entry as. With no database both live in
// process memory, the history-store shape.

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}

const MEMORY_CAP = 2000;
const states = new Map<string, StrategyState>();
const leases = new Map<string, { holder: string; until: number }>();
let tablesReady: Promise<boolean> | null = null;

function key(chainId: number, hireId: string): string {
  return `${chainId}:${hireId}`;
}

async function ensureTables(): Promise<boolean> {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql!`
        create table if not exists strategy_state (
          chain_id integer not null,
          hire_id text not null,
          generation integer not null,
          last_block numeric not null,
          last_price double precision not null,
          crossed jsonb not null default '[]'::jsonb,
          updated_at timestamptz not null default now(),
          primary key (chain_id, hire_id)
        )`;
      await sql!`
        create table if not exists strategy_lease (
          chain_id integer not null,
          hire_id text not null,
          holder text not null,
          until timestamptz not null,
          primary key (chain_id, hire_id)
        )`;
      return true;
    } catch {
      return false;
    }
  })();
  return tablesReady;
}

export async function getStrategyState(
  chainId: number,
  hireId: string,
): Promise<StrategyState | null> {
  const k = key(chainId, hireId);
  if (sql && (await ensureTables())) {
    try {
      const rows = await sql`
        select generation, last_block, last_price, crossed
        from strategy_state where chain_id = ${chainId} and hire_id = ${hireId}`;
      const row = rows[0] as
        | { generation: number; last_block: string; last_price: number; crossed: unknown }
        | undefined;
      if (!row) return null;
      return {
        generation: Number(row.generation),
        lastBlock: BigInt(row.last_block),
        lastPrice: Number(row.last_price),
        crossed: Array.isArray(row.crossed) ? row.crossed.map(String) : [],
      };
    } catch {
      // the store's outage must not decide anything; memory is the fallback
    }
  }
  return states.get(k) ?? null;
}

export async function saveStrategyState(
  chainId: number,
  hireId: string,
  state: StrategyState,
): Promise<void> {
  const k = key(chainId, hireId);
  if (states.size >= MEMORY_CAP && !states.has(k)) {
    const oldest = states.keys().next().value;
    if (oldest !== undefined) states.delete(oldest);
  }
  states.set(k, state);
  if (sql && (await ensureTables())) {
    try {
      await sql`
        insert into strategy_state (chain_id, hire_id, generation, last_block, last_price, crossed)
        values (${chainId}, ${hireId}, ${state.generation}, ${state.lastBlock.toString()}, ${state.lastPrice}, ${sql.json(state.crossed)})
        on conflict (chain_id, hire_id) do update set
          generation = excluded.generation,
          last_block = excluded.last_block,
          last_price = excluded.last_price,
          crossed = excluded.crossed,
          updated_at = now()`;
    } catch {
      // the memory row still stands; the next pass retries the durable one
    }
  }
}

// a lease is advisory between runners of the same fleet: the vault's on-chain
// refusal is the last line either way, and a stale lease expires on its clock
export async function acquireLease(
  chainId: number,
  hireId: string,
  holder: string,
  ttlMs: number,
  now = Date.now(),
): Promise<boolean> {
  const k = key(chainId, hireId);
  if (sql && (await ensureTables())) {
    try {
      const until = new Date(now + ttlMs).toISOString();
      const updated = await sql`
        update strategy_lease set holder = ${holder}, until = ${until}
        where chain_id = ${chainId} and hire_id = ${hireId} and until < now()`;
      if (Array.isArray(updated) && updated.count > 0) return true;
      const inserted = await sql`
        insert into strategy_lease (chain_id, hire_id, holder, until)
        values (${chainId}, ${hireId}, ${holder}, ${until})
        on conflict (chain_id, hire_id) do nothing`;
      return Array.isArray(inserted) && inserted.count > 0;
    } catch {
      // fall through to memory: one instance is still protected from itself
    }
  }
  const held = leases.get(k);
  if (held && held.until > now) return false;
  leases.set(k, { holder, until: now + ttlMs });
  return true;
}

export async function releaseLease(
  chainId: number,
  hireId: string,
  holder: string,
): Promise<void> {
  const k = key(chainId, hireId);
  const held = leases.get(k);
  if (held && held.holder === holder) leases.delete(k);
  if (sql && (await ensureTables())) {
    try {
      await sql`
        delete from strategy_lease
        where chain_id = ${chainId} and hire_id = ${hireId} and holder = ${holder}`;
    } catch {
      // the ttl is the backstop when a release is lost
    }
  }
}
