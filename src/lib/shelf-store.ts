// server-only durable backing for the shared shelf top up, enabled by DATABASE_URL.
// With no database every function is a no-op and the shelf stays in process memory,
// exactly as it did before, so a missing database degrades instead of throwing.

import "server-only";
import postgres from "postgres";
import type { AgentSummary } from "./types";
import { FRESH_ADMISSION_MS, isShelfReady } from "./agent-index";

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

let registryInitPromise: Promise<boolean> | null = null;

// The registry total lives in its own table so it can be written by a live read
// before any shelf row is, and read without touching the shelf. Same lazy latch
// and same clean degradation as the shelf table above.
function initRegistry(): Promise<boolean> {
  const c = client();
  if (!c) return Promise.resolve(false);
  if (!registryInitPromise) {
    registryInitPromise = (async () => {
      try {
        await Promise.race([
          c`
            create table if not exists registry_totals (
              chain_id integer primary key,
              total integer not null,
              updated_at timestamptz default now()
            )
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("registry db timeout")), 4000),
          ),
        ]);
        return true;
      } catch {
        registryInitPromise = null;
        return false;
      }
    })();
  }
  return registryInitPromise;
}

let catalogueInitPromise: Promise<boolean> | null = null;

// The catalogue meta row records the shared catalogue's own last refresh and what
// it saw, so the page can report the store's time instead of the committed file's
// date. Same lazy latch and same clean degradation as the tables above.
function initCatalogueMeta(): Promise<boolean> {
  const c = client();
  if (!c) return Promise.resolve(false);
  if (!catalogueInitPromise) {
    catalogueInitPromise = (async () => {
      try {
        await Promise.race([
          c`
            create table if not exists catalogue_meta (
              chain_id integer primary key,
              refreshed_at timestamptz,
              registry_total integer,
              shelf_size integer
            )
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("catalogue meta db timeout")), 4000),
          ),
        ]);
        return true;
      } catch {
        catalogueInitPromise = null;
        return false;
      }
    })();
  }
  return catalogueInitPromise;
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

export interface DurableShelfRead {
  rows: ShelfAgentRow[];
  // true only when the store is configured and the query ran. An absent or
  // unreachable database reports false, so its empty rows are never read as an
  // empty catalogue.
  ok: boolean;
}

// Read the fleet's shelf, newest learnings first, optionally narrowed to one
// chain, and report whether the store actually answered. Returns nothing when
// the store is absent or unreachable.
export async function readShelfAgents(
  chainId?: number,
): Promise<DurableShelfRead> {
  const c = client();
  if (!(await init()) || !c) return { rows: [], ok: false };
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
    return {
      rows: rows.map((r) => ({
        chain_id: Number(r.chain_id),
        token_id: String(r.token_id),
        payload: r.payload as AgentSummary,
        updated_at:
          r.updated_at instanceof Date
            ? r.updated_at.toISOString()
            : String(r.updated_at ?? ""),
      })),
      ok: true,
    };
  } catch {
    return { rows: [], ok: false };
  }
}

// The plain reader for callers that only need the rows. readShelfAgents is what
// tells an empty shelf from an unreadable one.
export async function loadShelfAgents(
  chainId?: number,
): Promise<ShelfAgentRow[]> {
  return (await readShelfAgents(chainId)).rows;
}

// An eviction is durable too, or a delisted agent would be merged back on the
// next process start.
export async function deleteShelfAgent(
  chainId: number,
  tokenId: string,
): Promise<void> {
  const c = client();
  if (!(await init()) || !c) return;
  // a row admitted on confirm inside the window stays, whichever instance asks:
  // one that never loaded it would otherwise delete what another just wrote
  const windowSeconds = FRESH_ADMISSION_MS / 1000;
  try {
    await c`
      delete from shelf_agents
      where chain_id = ${chainId} and token_id = ${tokenId}
        and not coalesce(
          (payload->>'admitted_at')::timestamptz > now() - make_interval(secs => ${windowSeconds}),
          false
        )
    `;
  } catch {
  }
}

// one stored row, for an instance that has not merged the fleet's shelf since
// the row was written
export async function readShelfAgent(
  chainId: number,
  tokenId: string,
): Promise<AgentSummary | null> {
  const c = client();
  if (!(await init()) || !c) return null;
  try {
    const rows = await c`
      select chain_id, token_id, payload from shelf_agents
      where chain_id = ${chainId} and token_id = ${tokenId}
      limit 1
    `;
    const row = rows[0] as { chain_id: number; token_id: string; payload: unknown } | undefined;
    return row ? summaryFromRow(row) : null;
  } catch {
    return null;
  }
}

// Persist the registry total a live read observed for a chain, so every instance
// answers with one denominator instead of the per-process figure that flickered.
// A non-positive total is not a denominator and is never stored.
export async function saveRegistryTotal(
  chainId: number,
  total: number,
): Promise<void> {
  const c = client();
  if (!Number.isFinite(total) || total <= 0) return;
  if (!(await initRegistry()) || !c) return;
  try {
    await c`
      insert into registry_totals (chain_id, total, updated_at)
      values (${chainId}, ${Math.floor(total)}, now())
      on conflict (chain_id) do update set
        total = excluded.total,
        updated_at = now()
    `;
  } catch {
    // the memory value stays whatever this process already had
  }
}

// Read the shared registry total for a chain. Nothing when the store is absent,
// unreachable, or has never observed one, so the caller omits the denominator
// rather than printing a figure only this process saw.
export async function loadRegistryTotal(
  chainId: number,
): Promise<number | null> {
  const c = client();
  if (!(await initRegistry()) || !c) return null;
  try {
    const rows = await c`
      select total from registry_totals where chain_id = ${chainId}
    `;
    if (rows.length === 0) return null;
    const total = Number(rows[0].total);
    return Number.isFinite(total) && total > 0 ? Math.floor(total) : null;
  } catch {
    return null;
  }
}

export interface CatalogueMeta {
  refreshedAt: string;
  registryTotal: number | null;
  shelfSize: number | null;
}

export interface CatalogueMetaInput {
  refreshedAt: string;
  registryTotal: number | null;
  shelfSize: number | null;
}

// A count is a figure only when it is a finite number; a missing column stays
// null rather than collapsing to zero.
function metaCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

// Record the shared catalogue's own refresh: the time, the registry total the
// refresh observed and the shelf size it served. Best effort, so a write miss
// leaves the previous record rather than failing the refresh.
export async function saveCatalogueMeta(
  chainId: number,
  meta: CatalogueMetaInput,
): Promise<void> {
  const c = client();
  const refreshedAt = new Date(meta.refreshedAt);
  if (Number.isNaN(refreshedAt.getTime())) return;
  if (!(await initCatalogueMeta()) || !c) return;
  try {
    const registryTotal = metaCount(meta.registryTotal);
    const shelfSize = metaCount(meta.shelfSize);
    await c`
      insert into catalogue_meta (chain_id, refreshed_at, registry_total, shelf_size)
      values (${chainId}, ${refreshedAt}, ${registryTotal}, ${shelfSize})
      on conflict (chain_id) do update set
        refreshed_at = excluded.refreshed_at,
        registry_total = excluded.registry_total,
        shelf_size = excluded.shelf_size
    `;
  } catch {
    // the page keeps reporting the previous record rather than a guess
  }
}

// Read the shared catalogue's refresh record. Null when the store is absent,
// unreachable, or has never refreshed, so the page falls back to the snapshot's
// date rather than inventing a freshness figure. A non-positive registry total
// is not a denominator and is reported as unknown.
export async function loadCatalogueMeta(
  chainId: number,
): Promise<CatalogueMeta | null> {
  const c = client();
  if (!(await initCatalogueMeta()) || !c) return null;
  try {
    const rows = await c`
      select refreshed_at, registry_total, shelf_size
      from catalogue_meta where chain_id = ${chainId}
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    const refreshedAt =
      row.refreshed_at instanceof Date
        ? row.refreshed_at
        : new Date(String(row.refreshed_at ?? ""));
    if (Number.isNaN(refreshedAt.getTime())) return null;
    const registryTotal = metaCount(row.registry_total);
    return {
      refreshedAt: refreshedAt.toISOString(),
      registryTotal:
        registryTotal !== null && registryTotal > 0 ? registryTotal : null,
      shelfSize: metaCount(row.shelf_size),
    };
  } catch {
    return null;
  }
}
