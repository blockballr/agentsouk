// server-only delisted listings: a token its owner has taken off the market,
// kept durably so a shelf top up does not merge it back. With no database the
// set lives in process memory, exactly as before, so a missing store degrades
// instead of throwing.

import "server-only";
import postgres from "postgres";

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

export async function loadDelisted(): Promise<Set<string>> {
  const set = new Set(memory);
  if ((await ensureTable()) && sql) {
    try {
      const rows = (await sql`select token_id from delisted_agents`) as { token_id: string }[];
      for (const r of rows) set.add(String(r.token_id));
    } catch {
    }
  }
  return set;
}

export async function setDelisted(
  tokenId: string,
  delisted: boolean,
  reason?: string,
): Promise<boolean> {
  if (delisted) memory.add(tokenId);
  else memory.delete(tokenId);
  if ((await ensureTable()) && sql) {
    try {
      if (delisted) {
        await sql`
          insert into delisted_agents (token_id, reason)
          values (${tokenId}, ${reason ?? null})
          on conflict (token_id) do update set reason = excluded.reason, delisted_at = now()
        `;
      } else {
        await sql`delete from delisted_agents where token_id = ${tokenId}`;
      }
    } catch {
      return false;
    }
  }
  return true;
}
