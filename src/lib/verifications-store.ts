// server-only verifications store: writes to postgres when DATABASE_URL is set,
// reads from postgres or falls back to data/verifications.json file

import "server-only";
import postgres from "postgres";
import type { Verification } from "@/lib/types";
import type { RecordedVerification } from "./verifications";

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
        (async () => {
          await sql!`
            create table if not exists verifications (
              token_id text primary key,
              name text not null default '',
              category text not null default '',
              status text not null,
              response_ms integer not null default 0,
              checked_at timestamptz not null,
              quality jsonb,
              concurrency text,
              detail text,
              failing_since timestamptz
            )
          `;
          // create-if-not-exists leaves an existing table alone, so add the
          // refusal reason to deployments that predate it
          await sql!`alter table verifications add column if not exists detail text`;
          await sql!`alter table verifications add column if not exists failing_since timestamptz`;
        })(),
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

// a gated agent answered behind its own login or payment, so it is alive and must
// not run the delist clock; only no answer at all counts as failing
export function countsAsFailing(status: Verification["status"]): boolean {
  return status !== "delivered" && status !== "gated";
}

export async function upsertVerification(
  tokenId: string,
  name: string,
  category: string,
  status: Verification["status"],
  responseMs: number,
  quality?: Verification["quality"],
  detail?: string,
  concurrency?: Verification["concurrency"],
): Promise<boolean> {
  if (!(await ensureTable()) || !sql) return false;
  try {
    await sql`
      insert into verifications (token_id, name, category, status, response_ms, checked_at, quality, concurrency, detail, failing_since)
      values (${tokenId}, ${name}, ${category}, ${status}, ${responseMs}, now(), ${quality ? JSON.stringify(quality) : null}::jsonb, ${concurrency ?? null}, ${detail ?? null}, ${countsAsFailing(status) ? new Date() : null})
      on conflict (token_id) do update set
        name = excluded.name,
        category = excluded.category,
        status = excluded.status,
        response_ms = excluded.response_ms,
        checked_at = now(),
        quality = excluded.quality,
        concurrency = excluded.concurrency,
        detail = excluded.detail,
        failing_since = case
          when excluded.failing_since is null then null
          when verifications.failing_since is null then now()
          else verifications.failing_since
        end
    `;
    return true;
  } catch (e) {
    // a silent write is how a sweep can report a verdict the page never shows,
    // so a failed write is logged and reported, never swallowed
    console.error("[verifications] upsert failed", tokenId, (e as Error).message);
    return false;
  }
}

// the same fingerprint for the verdicts: a changed count or a newer check means a full read is due
export async function loadVerificationsVersion(): Promise<string | null> {
  if (!(await ensureTable()) || !sql) return null;
  try {
    const [r] = await sql`select count(*)::int as n, max(checked_at) as at from verifications`;
    const at = r?.at instanceof Date ? r.at.toISOString() : String(r?.at ?? "");
    return `${r?.n ?? 0}:${at}`;
  } catch {
    return null;
  }
}

export async function loadVerificationsFromDb(): Promise<Map<string, RecordedVerification>> {
  const byToken = new Map<string, RecordedVerification>();
  if (!(await ensureTable()) || !sql) return byToken;
  try {
    const rows = await Promise.race([
      sql`
        select token_id, status, response_ms, checked_at, quality, concurrency, detail
        from verifications
        order by checked_at desc
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("verifications db timeout")), 4000),
      ),
    ]);
    for (const r of rows) {
      const v: RecordedVerification = {
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
      if (typeof r.detail === "string") {
        v.detail = r.detail;
      }
      byToken.set(String(r.token_id), v);
    }
  } catch {
  }
  return byToken;
}

export interface SweepQueueEntry {
  tokenId: string;
  name: string;
  category: string;
}

// Fresh listings jump the sweep queue so a new badge reflects a real probe within
// a sweep or two instead of waiting for a scheduled pass to notice the token.
// The table is tiny by design: one row per token, drained oldest-first with a
// per-run cap at the call site, so a listing flood cannot spend the relay dry.
export async function enqueueSweep(tokenId: string, name: string, category: string): Promise<boolean> {
  if (!(await ensureTable()) || !sql) return false;
  try {
    await sql`
      create table if not exists sweep_queue (
        token_id text primary key,
        name text not null default '',
        category text not null default '',
        created_at timestamptz not null default now()
      )
    `;
    await sql`
      insert into sweep_queue (token_id, name, category)
      values (${tokenId}, ${name}, ${category})
      on conflict (token_id) do nothing
    `;
    return true;
  } catch (e) {
    console.error("[verifications] sweep enqueue failed", tokenId, (e as Error).message);
    return false;
  }
}

export async function takeSweepQueue(limit: number): Promise<SweepQueueEntry[]> {
  const capped = Math.max(1, Math.min(25, Math.floor(limit) || 1));
  if (!(await ensureTable()) || !sql) return [];
  try {
    const rows = (await sql`
      delete from sweep_queue
      where token_id in (
        select token_id from sweep_queue order by created_at asc limit ${capped}
      )
      returning token_id, name, category
    `) as { token_id: string; name: string; category: string }[];
    return rows.map((r) => ({ tokenId: r.token_id, name: r.name, category: r.category }));
  } catch (e) {
    console.error("[verifications] sweep dequeue failed", (e as Error).message);
    return [];
  }
}

// Tokens that already hold a verification row, so selection can prefer the ones
// still waiting on their first probe. Best effort: an empty set simply keeps the
// old score-ranked order instead of failing the sweep.
export async function loadVerifiedTokenIds(): Promise<Set<string>> {
  if (!(await ensureTable()) || !sql) return new Set();
  try {
    const rows = (await sql`select token_id from verifications`) as { token_id: string }[];
    return new Set(rows.map((r) => String(r.token_id)));
  } catch (e) {
    console.error("[verifications] verified ids read failed", (e as Error).message);
    return new Set();
  }
}

export interface StaleToken {
  tokenId: string;
  name: string;
  category: string;
  status: string;
  failingSince: string;
}

// Tokens the verifier has read as not-delivered continuously for at least the
// window, so maintenance can warn the owner and then delist. A delivered reading
// clears failing_since, so a token never reaches here on a single bad sweep.
export async function loadStaleTokens(olderThanMs: number): Promise<StaleToken[]> {
  if (!(await ensureTable()) || !sql) return [];
  try {
    const rows = (await sql`
      select token_id, name, category, status, failing_since
      from verifications
      where failing_since is not null
        and status <> 'delivered'
        and extract(epoch from (now() - failing_since)) * 1000 >= ${olderThanMs}
      order by failing_since asc
    `) as {
      token_id: string;
      name: string;
      category: string;
      status: string;
      failing_since: unknown;
    }[];
    return rows.map((r) => ({
      tokenId: String(r.token_id),
      name: r.name,
      category: r.category,
      status: r.status,
      failingSince:
        r.failing_since instanceof Date
          ? r.failing_since.toISOString()
          : String(r.failing_since),
    }));
  } catch (e) {
    console.error("[verifications] stale read failed", (e as Error).message);
    return [];
  }
}
