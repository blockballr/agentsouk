// server-only history: every check of an agent and every run of a scheduled job, kept as
// they happen. The verifications store holds only the latest result per agent, so without
// this there is nothing to draw over time. With no database both live in process memory

import "server-only";
import postgres from "postgres";
import type { NextResponse } from "next/server";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

export interface CheckRecord {
  tokenId: string;
  status: string;
  responseMs: number | null;
  checkedAt: string;
}

export interface CronRun {
  name: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  note: string | null;
}

const MEMORY_CAP = 2000;
const checks: CheckRecord[] = [];
const runs: CronRun[] = [];
let tablesReady: Promise<boolean> | null = null;

async function ensureTables(): Promise<boolean> {
  if (!sql) return false;
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    try {
      await sql!`
        create table if not exists check_history (
          id bigserial primary key,
          token_id text not null,
          status text not null,
          response_ms integer,
          checked_at timestamptz not null default now()
        )
      `;
      await sql!`create index if not exists check_history_token_at on check_history (token_id, checked_at desc)`;
      await sql!`create index if not exists check_history_at on check_history (checked_at)`;
      await sql!`
        create table if not exists cron_runs (
          id bigserial primary key,
          name text not null,
          started_at timestamptz not null,
          finished_at timestamptz not null,
          ok boolean not null,
          note text
        )
      `;
      await sql!`create index if not exists cron_runs_name_at on cron_runs (name, started_at desc)`;
      return true;
    } catch {
      tablesReady = null;
      return false;
    }
  })();
  return tablesReady;
}

function remember<T>(list: T[], entry: T): void {
  list.push(entry);
  if (list.length > MEMORY_CAP) list.splice(0, list.length - MEMORY_CAP);
}

// a history line is never worth holding a check or a job for, so a write that has not landed
// by this is given up and reported as lost
const WRITE_CAP_MS = 3000;

function within(work: Promise<boolean>, what: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      console.error("[history] gave up waiting to record", what);
      resolve(false);
    }, WRITE_CAP_MS);
  });
  return Promise.race([work, cap]).finally(() => clearTimeout(timer));
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

// memory stands in only where there is no database at all; with one configured, a line that
// cannot be written is reported lost, never kept somewhere a reader will not look
export function recordCheck(tokenId: string, status: string, responseMs: number | null): Promise<boolean> {
  const at = new Date().toISOString();
  if (!sql) {
    remember(checks, { tokenId, status, responseMs, checkedAt: at });
    return Promise.resolve(true);
  }
  const db = sql;
  return within(
    (async () => {
      try {
        if (!(await ensureTables())) throw new Error("history tables unavailable");
        await db`
          insert into check_history (token_id, status, response_ms, checked_at)
          values (${tokenId}, ${status}, ${responseMs}, ${at})
        `;
        return true;
      } catch (e) {
        console.error("[history] check not recorded", tokenId, reason(e));
        return false;
      }
    })(),
    `check of ${tokenId}`,
  );
}

// the most recent checks of each token, newest first, for the strip under a listing
export async function recentChecks(tokenIds: readonly string[], perToken = 30): Promise<Map<string, CheckRecord[]>> {
  const out = new Map<string, CheckRecord[]>();
  if (tokenIds.length === 0) return out;
  if ((await ensureTables()) && sql) {
    try {
      const rows = (await sql`
        select token_id, status, response_ms, checked_at from (
          select token_id, status, response_ms, checked_at,
                 row_number() over (partition by token_id order by checked_at desc) as n
          from check_history where token_id in ${sql([...tokenIds])}
        ) ranked where n <= ${perToken} order by checked_at desc
      `) as { token_id: string; status: string; response_ms: number | null; checked_at: Date | string }[];
      for (const r of rows) {
        const list = out.get(r.token_id) ?? [];
        list.push({ tokenId: r.token_id, status: r.status, responseMs: r.response_ms, checkedAt: new Date(r.checked_at).toISOString() });
        out.set(r.token_id, list);
      }
      return out;
    } catch {
      return out;
    }
  }
  const wanted = new Set(tokenIds);
  for (let i = checks.length - 1; i >= 0; i--) {
    const c = checks[i];
    if (!wanted.has(c.tokenId)) continue;
    const list = out.get(c.tokenId) ?? [];
    if (list.length < perToken) list.push(c);
    out.set(c.tokenId, list);
  }
  return out;
}

// every check since a moment, oldest first, for counting by day. Past the limit it is the
// oldest that are left out, so the latest days are always whole
export async function checksSince(since: Date): Promise<CheckRecord[]> {
  if ((await ensureTables()) && sql) {
    try {
      const rows = (await sql`
        select token_id, status, response_ms, checked_at from check_history
        where checked_at >= ${since.toISOString()} order by checked_at desc limit 20000
      `) as { token_id: string; status: string; response_ms: number | null; checked_at: Date | string }[];
      return rows.reverse().map((r) => ({
        tokenId: r.token_id,
        status: r.status,
        responseMs: r.response_ms,
        checkedAt: new Date(r.checked_at).toISOString(),
      }));
    } catch {
      return [];
    }
  }
  return checks.filter((c) => Date.parse(c.checkedAt) >= since.getTime());
}

export function recordCronRun(run: CronRun): Promise<boolean> {
  if (!sql) {
    remember(runs, run);
    return Promise.resolve(true);
  }
  const db = sql;
  return within(
    (async () => {
      try {
        if (!(await ensureTables())) throw new Error("history tables unavailable");
        await db`
          insert into cron_runs (name, started_at, finished_at, ok, note)
          values (${run.name}, ${run.startedAt}, ${run.finishedAt}, ${run.ok}, ${run.note})
        `;
        return true;
      } catch (e) {
        console.error("[history] job run not recorded", run.name, reason(e));
        return false;
      }
    })(),
    `run of ${run.name}`,
  );
}

// the latest run of each job, so a panel can say what ran and what did not
export async function latestCronRuns(): Promise<CronRun[]> {
  if ((await ensureTables()) && sql) {
    try {
      const rows = (await sql`
        select distinct on (name) name, started_at, finished_at, ok, note
        from cron_runs order by name, started_at desc
      `) as { name: string; started_at: Date | string; finished_at: Date | string; ok: boolean; note: string | null }[];
      return rows.map((r) => ({
        name: r.name,
        startedAt: new Date(r.started_at).toISOString(),
        finishedAt: new Date(r.finished_at).toISOString(),
        ok: r.ok,
        note: r.note,
      }));
    } catch {
      return [];
    }
  }
  const latest = new Map<string, CronRun>();
  for (const r of runs) latest.set(r.name, r);
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// wraps a scheduled route so each real run leaves one line. A caller without the secret, or
// a deployment where the job is not configured, never ran the job and so leaves none
export async function loggedCronRun(name: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  const startedAt = new Date().toISOString();
  let res: NextResponse;
  try {
    res = await run();
  } catch (e) {
    await recordCronRun({ name, startedAt, finishedAt: new Date().toISOString(), ok: false, note: reason(e).slice(0, 200) });
    throw e;
  }
  if (res.status !== 401 && res.status !== 503) {
    const ok = res.status < 400;
    await recordCronRun({ name, startedAt, finishedAt: new Date().toISOString(), ok, note: ok ? null : `answered ${res.status}` });
  }
  return res;
}

export function resetHistoryForTests(): void {
  checks.length = 0;
  runs.length = 0;
}
