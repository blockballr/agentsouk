// server-only store for listing impressions. One row per reader per listing per
// hour, so a refresh or a tab left open is never a second impression, and the
// row keeps a hash rather than an address.

import "server-only";
import postgres from "postgres";
import { createHash } from "node:crypto";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await sql!`
        create table if not exists listing_views (
          chain_id integer not null,
          token_id text not null,
          visitor text not null,
          bucket timestamptz not null,
          at timestamptz not null default now(),
          primary key (chain_id, token_id, visitor, bucket)
        )
      `;
      return true;
    } catch (e) {
      console.error(
        "[views] could not create listing_views:",
        e instanceof Error ? e.message : String(e),
      );
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

// the reader is a hash of address and user agent, salted with a server secret so
// the table cannot be turned back into a list of addresses if it leaks
export function visitorKey(ip: string, userAgent: string): string {
  const salt = process.env.VIEW_SALT ?? "agentsouk-views";
  return createHash("sha256").update(`${salt}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

export async function recordListingView(
  chainId: number,
  tokenId: string,
  visitor: string,
): Promise<boolean> {
  if (!(await ensureTable()) || !sql) return false;
  try {
    await sql`
      insert into listing_views (chain_id, token_id, visitor, bucket)
      values (${chainId}, ${tokenId}, ${visitor}, date_trunc('hour', now()))
      on conflict do nothing
    `;
    return true;
  } catch (e) {
    console.error(
      "[views] could not record an impression:",
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}

export async function readListingViews(
  chainId: number,
  tokenIds: readonly string[],
  days = 14,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tokenIds.length === 0) return counts;
  if (!(await ensureTable()) || !sql) return counts;
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const rows = (await sql`
      select token_id, count(*)::int as views
      from listing_views
      where chain_id = ${chainId} and token_id in ${sql([...tokenIds])} and at >= ${since}
      group by token_id
    `) as { token_id: string; views: number }[];
    for (const row of rows) counts.set(String(row.token_id), Number(row.views));
  } catch (e) {
    console.error(
      "[views] could not read impressions:",
      e instanceof Error ? e.message : String(e),
    );
  }
  return counts;
}
