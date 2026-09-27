// server-only durable backing for the shared shelf top up, enabled by DATABASE_URL.
// With no database every function is a no-op and the shelf stays in process memory,
// exactly as it did before, so a missing database degrades instead of throwing.

import "server-only";
import postgres from "postgres";
import type { AgentSummary } from "./types";
import { isShelfReady } from "./agent-index";

export type ShelfStoreMode = "shared" | "per-process";

type Sql = ReturnType<typeof postgres>;

let sql: Sql | null = null;
let sqlResolved = false;

// The client is built on first use rather than at import, so a test or a build
// that only reads the pure helpers never opens a connection.
function client(): Sql | null {
  if (!sqlResolved) {
    sqlResolved = true;
    sql = process.env.DATABASE_URL
      ? postgres(process.env.DATABASE_URL, {
          max: 1,
          idle_timeout: 20,
          connect_timeout: 5,
        })
      : null;
  }
  return sql;
}

export function shelfStoreMode(): ShelfStoreMode {
  return client() ? "shared" : "per-process";
}

let initPromise: Promise<boolean> | null = null;

// Lazy table creation: the first read or write makes the table, and a failed
// attempt clears the latch so a later call can retry.
function init(): Promise<boolean> {
  const c = client();
  if (!c) return Promise.resolve(false);
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Promise.race([
          c`
            create table if not exists shelf_agents (
              chain_id integer not null,
              token_id text not null,
              payload jsonb not null,
              updated_at timestamptz default now(),
              primary key (chain_id, token_id)
            )
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("shelf db timeout")), 4000),
          ),
        ]);
        return true;
      } catch {
        initPromise = null;
        return false;
      }
    })();
  }
  return initPromise;
}

export interface ShelfAgentRow {
  chain_id: number;
  token_id: string;
  payload: AgentSummary;
  updated_at: string;
}

// The durable row is exactly the summary the shelf serves, keyed by chain and
// token so a later pull of the same agent upserts instead of duplicating. A
// fully inflated registry record is never stored, only what a browse reads.
export function rowFromSummary(
  summary: AgentSummary,
  updatedAt: string = new Date().toISOString(),
): ShelfAgentRow {
  return {
    chain_id: summary.chain_id,
    token_id: summary.token_id,
    payload: summary,
    updated_at: updatedAt,
  };
}

// A stored row becomes a shelf entry only while it still passes the admission
// gate. The gate is re-run on read, so a row that no longer qualifies is not
// served however it got in.
export function summaryFromRow(row: {
  chain_id: number;
  token_id: string;
  payload: unknown;
}): AgentSummary | null {
  const payload = row.payload;
  if (!payload || typeof payload !== "object") return null;
  const summary = payload as AgentSummary;
  if (summary.chain_id !== row.chain_id || summary.token_id !== row.token_id) {
    return null;
  }
  return isShelfReady(summary) ? summary : null;
}

// Upsert every admitted summary from one top up. Best effort: the in-memory shelf
// already holds them, so a write miss must never fail the pull.
export async function saveShelfAgents(
  summaries: readonly AgentSummary[],
): Promise<void> {
  const c = client();
  if (summaries.length === 0 || !(await init()) || !c) return;
  try {
    for (const summary of summaries) {
      await c`
        insert into shelf_agents (chain_id, token_id, payload, updated_at)
        values (
          ${summary.chain_id},
          ${summary.token_id},
          ${c.json(summary as never)},
          now()
        )
        on conflict (chain_id, token_id) do update set
          payload = excluded.payload,
          updated_at = now()
      `;
    }
  } catch {
    // the memory shelf remains the source of truth when the store is unreachable
  }
}

// Read the fleet's shelf, newest learnings first, optionally narrowed to one
// chain. Returns nothing when the store is absent or unreachable.
export async function loadShelfAgents(
  chainId?: number,
): Promise<ShelfAgentRow[]> {
  const c = client();
  if (!(await init()) || !c) return [];
  try {
    const rows =
      chainId === undefined
        ? await c`
            select chain_id, token_id, payload, updated_at
            from shelf_agents
            order by updated_at desc
          `
        : await c`
            select chain_id, token_id, payload, updated_at
            from shelf_agents
            where chain_id = ${chainId}
            order by updated_at desc
          `;
    return rows.map((r) => ({
      chain_id: Number(r.chain_id),
      token_id: String(r.token_id),
      payload: r.payload as AgentSummary,
      updated_at:
        r.updated_at instanceof Date
          ? r.updated_at.toISOString()
          : String(r.updated_at ?? ""),
    }));
  } catch {
    return [];
  }
}

// An eviction is durable too, or a delisted agent would be merged back on the
// next process start.
export async function deleteShelfAgent(
  chainId: number,
  tokenId: string,
): Promise<void> {
  const c = client();
  if (!(await init()) || !c) return;
  try {
    await c`
      delete from shelf_agents where chain_id = ${chainId} and token_id = ${tokenId}
    `;
  } catch {
  }
}
