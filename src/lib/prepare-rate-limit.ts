// Write-rate guard for the public prepare endpoint: the 24h claim TTL bounds row
// accumulation but not how fast rows can be written. The owner is caller-supplied and unverified, so the client IP is counted too; postgres is authoritative when configured, and a store that cannot be reached rejects rather than fails open.

import "server-only";

// Ten per hour per key: a builder needs a handful of attempts, while a sustained loop
// writes at most 240 rows per key per day, which the claim TTL then sweeps.
const LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;
const WINDOW_SECONDS = WINDOW_MS / 1000;
// Above this the map is swept of closed windows, so a caller spraying keys
// cannot grow it without bound.
const SWEEP_AT = 5000;

interface Window {
  count: number;
  windowStart: number;
}

const memory = new Map<string, Window>();

type Sql = {
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>;
};

let client: Promise<Sql | null> | null = null;
let tableReady: Promise<boolean> | null = null;

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

async function ensureTable(sql: Sql): Promise<boolean> {
  if (tableReady === null) {
    tableReady = (async () => {
      try {
        await sql.unsafe(`
          create table if not exists prepare_rate_limits (
            key text primary key,
            count integer not null default 0,
            window_start timestamptz not null default now()
          );
        `);
        return true;
      } catch {
        tableReady = null;
        return false;
      }
    })();
  }
  return tableReady;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// The keys a request is counted against. Owner first so a wallet that has spent
// its own allowance is refused before the shared IP counter is touched.
export function prepareRateKeys(input: {
  owner?: string | null;
  ip?: string | null;
}): string[] {
  const keys: string[] = [];
  const owner = (input.owner ?? "").trim().toLowerCase();
  if (owner) keys.push(`owner:${owner}`);
  // the left-most forwarded entry is the client when a proxy wrote the header; with no proxy
  // it is caller-controlled, which is why the owner counter is not trusted on its own
  const ip = (input.ip ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  keys.push(`ip:${ip || "unknown"}`);
  return keys;
}

function verdict(count: number, resetAt: number, now: number): RateLimitVerdict {
  return {
    allowed: count <= LIMIT,
    remaining: Math.max(0, LIMIT - count),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
  };
}

function sweep(now: number): void {
  for (const [key, window] of memory) {
    if (now - window.windowStart >= WINDOW_MS) memory.delete(key);
  }
}

function hitMemory(key: string): RateLimitVerdict {
  const now = Date.now();
  if (memory.size > SWEEP_AT) sweep(now);
  const existing = memory.get(key);
  const fresh = !existing || now - existing.windowStart >= WINDOW_MS;
  const windowStart = fresh ? now : existing.windowStart;
  const count = fresh ? 1 : existing.count + 1;
  memory.set(key, { count, windowStart });
  return verdict(count, windowStart + WINDOW_MS, now);
}

async function hitPostgres(sql: Sql, key: string): Promise<RateLimitVerdict> {
  const rows = (await sql.unsafe(
    `insert into prepare_rate_limits (key, count, window_start)
     values ($1, 1, now())
     on conflict (key) do update
       set count = case
             when prepare_rate_limits.window_start < now() - make_interval(secs => $2)
             then 1
             else prepare_rate_limits.count + 1
           end,
           window_start = case
             when prepare_rate_limits.window_start < now() - make_interval(secs => $2)
             then now()
             else prepare_rate_limits.window_start
           end
     returning count, window_start`,
    [key, WINDOW_SECONDS],
  )) as Array<{ count: number; window_start: Date | string }>;
  const row = rows[0];
  const start = new Date(row.window_start).getTime();
  return verdict(row.count, start + WINDOW_MS, Date.now());
}

// Counts one request against every key and returns the tightest verdict; throws when a
// configured store cannot be reached, which the route turns into a refusal rather than an uncapped write.
export async function enforcePrepareRateLimit(input: {
  owner?: string | null;
  ip?: string | null;
}): Promise<RateLimitVerdict> {
  const keys = prepareRateKeys(input);
  if (!process.env.DATABASE_URL) {
    let tightest: RateLimitVerdict = { allowed: true, remaining: LIMIT, retryAfterSeconds: 0 };
    for (const key of keys) {
      const result = hitMemory(key);
      if (!result.allowed) return result;
      if (result.remaining < tightest.remaining) tightest = result;
    }
    return tightest;
  }
  const sql = await db();
  if (!sql) throw new Error("prepare rate limit store is unavailable");
  if (!(await ensureTable(sql))) {
    tableReady = null;
    throw new Error("prepare rate limit store is unavailable");
  }
  let tightest: RateLimitVerdict = {
    allowed: true,
    remaining: LIMIT,
    retryAfterSeconds: 0,
  };
  for (const key of keys) {
    const result = await hitPostgres(sql, key);
    if (!result.allowed) return result;
    if (result.remaining < tightest.remaining) tightest = result;
  }
  return tightest;
}

export function resetForTests(): void {
  memory.clear();
  client = null;
  tableReady = null;
}
