// Reusable fixed-window rate limiter for public endpoints. Postgres is the
// authoritative counter when DATABASE_URL is set and each policy owns its own
// table, so one endpoint's traffic cannot consume another's allowance; a store
// that cannot be reached rejects rather than fails open.

import "server-only";

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitPolicy {
  // unique per endpoint, so counters never bleed between routes
  table: string;
  limit: number;
  windowMs: number;
}

interface Window {
  count: number;
  windowStart: number;
  windowMs: number;
}

type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
};

// Above this the map is swept of closed windows, so a caller spraying keys
// cannot grow it without bound.
const SWEEP_AT = 5000;

const memory = new Map<string, Window>();

let client: Promise<Sql | null> | null = null;
const tableReady = new Map<string, Promise<boolean>>();

const TABLE_RE = /^[a-z_][a-z0-9_]*$/;

function tableFor(policy: RateLimitPolicy): string {
  if (!TABLE_RE.test(policy.table)) {
    throw new Error("invalid rate limit table name");
  }
  return policy.table;
}

async function db(): Promise<Sql | null> {
  if (!client) {
    client = (async () => {
      const url = process.env.DATABASE_URL;
      if (!url) return null;
      try {
        const mod = (await import("postgres")) as unknown as {
          default: (url: string, opts?: object) => unknown;
        };
        return mod.default(url, { max: 1, idle_timeout: 20, connect_timeout: 5 }) as Sql;
      } catch {
        return null;
      }
    })();
  }
  return client;
}

function ensureTable(sql: Sql, table: string): Promise<boolean> {
  const existing = tableReady.get(table);
  if (existing) return existing;
  const created = (async () => {
    try {
      await sql.unsafe(`
        create table if not exists ${table} (
          key text primary key,
          count integer not null default 0,
          window_start timestamptz not null default now()
        );
      `);
      return true;
    } catch {
      tableReady.delete(table);
      return false;
    }
  })();
  tableReady.set(table, created);
  return created;
}

// The left-most forwarded entry is the client when a proxy wrote the header;
// with no proxy it is caller controlled, which is why it is a best-effort key.
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "";
  return forwarded.split(",")[0]?.trim().toLowerCase() || "unknown";
}

function verdict(
  policy: RateLimitPolicy,
  count: number,
  resetAt: number,
  now: number,
): RateLimitVerdict {
  return {
    allowed: count <= policy.limit,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
  };
}

function sweep(now: number): void {
  for (const [key, window] of memory) {
    if (now - window.windowStart >= window.windowMs) memory.delete(key);
  }
}

function hitMemory(policy: RateLimitPolicy, key: string): RateLimitVerdict {
  const now = Date.now();
  if (memory.size > SWEEP_AT) sweep(now);
  const composite = `${policy.table}\u0000${key}`;
  const existing = memory.get(composite);
  const fresh = !existing || now - existing.windowStart >= policy.windowMs;
  const windowStart = fresh ? now : existing.windowStart;
  const count = fresh ? 1 : existing.count + 1;
  memory.set(composite, { count, windowStart, windowMs: policy.windowMs });
  return verdict(policy, count, windowStart + policy.windowMs, now);
}

async function hitPostgres(
  sql: Sql,
  policy: RateLimitPolicy,
  key: string,
): Promise<RateLimitVerdict> {
  const table = policy.table;
  const windowSeconds = policy.windowMs / 1000;
  const rows = (await sql.unsafe(
    `insert into ${table} (key, count, window_start)
     values ($1, 1, now())
     on conflict (key) do update
       set count = case
             when ${table}.window_start < now() - make_interval(secs => $2)
             then 1
             else ${table}.count + 1
           end,
           window_start = case
             when ${table}.window_start < now() - make_interval(secs => $2)
             then now()
             else ${table}.window_start
           end
     returning count, window_start`,
    [key, windowSeconds],
  )) as Array<{ count: number; window_start: Date | string }>;
  const row = rows[0];
  const start = new Date(row.window_start).getTime();
  return verdict(policy, row.count, start + policy.windowMs, Date.now());
}

// Counts one request against every key and returns the tightest verdict; throws
// when a configured store cannot be reached, which the route turns into a
// refusal rather than an uncapped call.
export async function enforceRateLimit(
  policy: RateLimitPolicy,
  input: { keys: string[] },
): Promise<RateLimitVerdict> {
  const table = tableFor(policy);
  const keys = input.keys.filter((key) => key.length > 0);
  if (keys.length === 0) throw new Error("rate limit requires at least one key");

  let tightest: RateLimitVerdict = {
    allowed: true,
    remaining: policy.limit,
    retryAfterSeconds: 0,
  };

  if (!process.env.DATABASE_URL) {
    for (const key of keys) {
      const result = hitMemory(policy, key);
      if (!result.allowed) return result;
      if (result.remaining < tightest.remaining) tightest = result;
    }
    return tightest;
  }

  const sql = await db();
  if (!sql) throw new Error("rate limit store is unavailable");
  if (!(await ensureTable(sql, table))) {
    throw new Error("rate limit store is unavailable");
  }
  for (const key of keys) {
    const result = await hitPostgres(sql, policy, key);
    if (!result.allowed) return result;
    if (result.remaining < tightest.remaining) tightest = result;
  }
  return tightest;
}

export function resetRateLimitsForTests(): void {
  memory.clear();
  client = null;
  tableReady.clear();
}
