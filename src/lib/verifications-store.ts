// server-only verifications store: writes to postgres when DATABASE_URL is set,
// reads from postgres or falls back to data/verifications.json file

import "server-only";
import postgres from "postgres";
import type { Verification } from "@/lib/types";

let sql: ReturnType<typeof postgres> | null = null;

if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
    // keep a slow Neon/pooler from stalling every marketplace request
    transform: { undefined: null },
  });
}

let tableReady: Promise<boolean> | null = null;

async function ensureTable(): Promise<boolean> {
  if (!sql) return false;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await Promise.race([
        sql!`
          create table if not exists verifications (
            token_id text primary key,
            name text not null default '',
            category text not null default '',
            status text not null,
            response_ms integer not null default 0,
            checked_at timestamptz not null,
            quality jsonb,
            concurrency text
          )
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("verifications db connect timeout")), 4000),
        ),
      ]);
      return true;
    } catch {
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

export async function upsertVerification(
  tokenId: string,
  name: string,
  category: string,
  status: Verification["status"],
  responseMs: number,
  quality?: Verification["quality"],
  concurrency?: Verification["concurrency"],
): Promise<void> {
  if (!(await ensureTable()) || !sql) return;
  try {
    await sql`
      insert into verifications (token_id, name, category, status, response_ms, checked_at, quality, concurrency)
      values (${tokenId}, ${name}, ${category}, ${status}, ${responseMs}, now(), ${quality ? JSON.stringify(quality) : null}::jsonb, ${concurrency ?? null})
      on conflict (token_id) do update set
        name = excluded.name,
        category = excluded.category,
        status = excluded.status,
        response_ms = excluded.response_ms,
        checked_at = now(),
        quality = excluded.quality,
        concurrency = excluded.concurrency
    `;
  } catch {
    // best-effort: file fallback or stale data is acceptable
  }
}

export async function loadVerificationsFromDb(): Promise<Map<string, Verification>> {
  const byToken = new Map<string, Verification>();
  if (!(await ensureTable()) || !sql) return byToken;
  try {
    const rows = await Promise.race([
      sql`
        select token_id, status, response_ms, checked_at, quality, concurrency
        from verifications
        order by checked_at desc
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("verifications db timeout")), 4000),
      ),
    ]);
    for (const r of rows) {
      const v: Verification = {
        status: r.status as Verification["status"],
        responseMs: r.response_ms,
        checkedAt: r.checked_at instanceof Date ? r.checked_at.toISOString() : String(r.checked_at),
      };
      if (r.quality && typeof r.quality === "object") {
        v.quality = r.quality as Verification["quality"];
      }
      if (r.concurrency) {
        v.concurrency = r.concurrency as Verification["concurrency"];
      }
      byToken.set(String(r.token_id), v);
    }
  } catch {
  }
  return byToken;
}
