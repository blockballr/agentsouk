// server-only delisted listings: a token its owner has taken off the market,
// kept durably so a shelf top up does not merge it back. With no database the
// set lives in process memory, exactly as before, so a missing store degrades
// instead of throwing.

import "server-only";
import postgres from "postgres";
import { pickDelisted, type DelistedRow } from "./listing-control";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

const memory = new Set<string>();
let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists delisted_agents (
          token_id text primary key,
          reason text,
          delisted_at timestamptz not null default now()
        )
      `;
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

export async function loadDelistedRows(): Promise<Map<string, DelistedRow>> {
  let dbRows: DelistedRow[] | null = null;
  if ((await ensureTable()) && sql) {
    try {
      const rows = (await sql`select token_id, reason, delisted_at from delisted_agents`) as {
        token_id: string;
        reason: string | null;
        delisted_at: Date | string | null;
      }[];
      dbRows = rows.map((r) => ({
        tokenId: String(r.token_id),
        reason: r.reason ?? null,
        delistedAt: r.delisted_at ? new Date(r.delisted_at).toISOString() : null,
      }));
      // keep the fallback in step, so a later failed read serves what the database last said
      memory.clear();
      for (const r of dbRows) memory.add(r.tokenId);
    } catch {
    }
  }
  return pickDelisted(dbRows, memory);
}

export async function loadDelisted(): Promise<Set<string>> {
  return new Set((await loadDelistedRows()).keys());
}

export async function setDelisted(
  tokenId: string,
  delisted: boolean,
  reason?: string,
): Promise<boolean> {
  if ((await ensureTable()) && sql) {
    try {
      if (delisted) {
        // the first delist stands: the daily sweep re-runs for every stale token and must not
        // rewrite an owner's delist as its own or move its date
        await sql`
          insert into delisted_agents (token_id, reason)
          values (${tokenId}, ${reason ?? null})
          on conflict (token_id) do nothing
        `;
      } else {
        await sql`delete from delisted_agents where token_id = ${tokenId}`;
      }
    } catch {
      return false;
    }
  }
  // after the write, so a failed write does not leave memory saying otherwise
  if (delisted) memory.add(tokenId);
  else memory.delete(tokenId);
  return true;
}
