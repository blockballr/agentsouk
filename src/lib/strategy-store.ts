import "server-only";

import postgres from "postgres";
import type { StrategyState } from "./grid-strategy";

// The layer's cache: one row per hire. The lease that keeps two runners off the
// same hire lives in lease-store.ts, shared with the health watch. Nothing here
// outranks the chain; it is the same cache the layer treats every entry as.
// With no database the state lives in process memory, the history-store shape.

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

// a failed trade must not leave the rung it tried to fill marked as filled
export async function clearStrategyState(chainId: number, hireId: string): Promise<void> {
  const k = key(chainId, hireId);
  states.delete(k);
  if (sql && (await ensureTables())) {
    try {
      await sql`delete from strategy_state where chain_id = ${chainId} and hire_id = ${hireId}`;
    } catch {
      // the memory row is gone; the durable one is retried on the next pass
    }
  }
}
