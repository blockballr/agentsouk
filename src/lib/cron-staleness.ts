// cron staleness: the difference between a job's allowed silence and the age of
// its last real run. loggedCronRun writes one durable line per run, so the
// checker reads facts, not promises: a route whose runner is dead shows as the
// age of its last recorded run, and nothing is sent until that passes budget.

import "server-only";

import postgres from "postgres";
import type { CronRun } from "./history-store";

export interface RouteBudget {
  name: string;
  // how long silence is tolerated. the observed gh action slippage to three or
  // four runs a day keeps a refresh gap near 7 hours, so the budget sits past
  // that and only a genuinely stopped runner breaches it
  allowedGapMs: number;
  label: string;
}

export const ROUTE_BUDGETS: readonly RouteBudget[] = [
  { name: "refresh", allowedGapMs: 12 * 3_600_000, label: "catalogue refresh" },
  { name: "verify", allowedGapMs: 26 * 3_600_000, label: "verifier sweep" },
  { name: "pancake", allowedGapMs: 26 * 3_600_000, label: "pancake sweep" },
  { name: "maintenance", allowedGapMs: 30 * 3_600_000, label: "maintenance pass" },
];

export interface StaleRoute {
  name: string;
  label: string;
  lastRunAt: string | null;
  ok: boolean;
  note: string | null;
  age: number | null;
  allowedGapMs: number;
}

// the pure read: latestCronRuns in, breaches out. a route with no recorded run
// at all is the worst breach, and a failed run is reported too, but a failed
// run is not by itself staleness: the runner is alive, the job refused
export function stalenessBreaches(runs: readonly CronRun[], now = Date.now()): StaleRoute[] {
  const byName = new Map<string, CronRun>();
  for (const run of runs) {
    const current = byName.get(run.name);
    if (!current || run.startedAt > current.startedAt) byName.set(run.name, run);
  }
  const out: StaleRoute[] = [];
  for (const { name, allowedGapMs, label } of ROUTE_BUDGETS) {
    const run = byName.get(name) ?? null;
    const last = run ? Date.parse(run.startedAt) : null;
    const age = last !== null && Number.isFinite(last) ? now - last : null;
    if (age !== null && age <= allowedGapMs) continue;
    out.push({
      name,
      label,
      lastRunAt: run ? run.startedAt : null,
      ok: run?.ok ?? false,
      note: run?.note ?? null,
      age,
      allowedGapMs,
    });
  }
  return out;
}

export function alertLine(stale: StaleRoute): string {
  const at = stale.lastRunAt ? new Date(stale.lastRunAt).toISOString() : "never";
  const age = stale.age !== null ? `${Math.round(stale.age / 3_600_000)}h` : "no run recorded";
  const note = stale.note ? `, last note: ${stale.note}` : "";
  return `${stale.name} (${stale.label}): last run ${at}, silence ${age}, allowed ${Math.round(stale.allowedGapMs / 3_600_000)}h, last result ${stale.ok ? "ok" : "failed"}${note}`;
}

// the dedupe store: one alert per route per half budget, so a stopped runner
// that nobody fixes does not become an email storm

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 5 });
}
let ready: Promise<boolean> | null = null;

function ensure(): Promise<boolean> {
  if (!sql) return Promise.resolve(false);
  if (!ready) {
    ready = (async () => {
      try {
        await sql!`
          create table if not exists cron_alerts (
            name text primary key,
            sent_at timestamptz not null default now()
          )
        `;
        return true;
      } catch {
        ready = null;
        return false;
      }
    })();
  }
  return ready;
}

// false when the route's last alert is still within half its budget: those get
// reported to the caller but not re emailed. without a store there is no way to
// dedupe, so nothing is emailed there either
export async function shouldEmail(route: string, halfGapMs: number): Promise<boolean> {
  if (!(await ensure())) return false;
  try {
    const rows = await sql!`
      select sent_at from cron_alerts where name = ${route}
    `;
    const row = rows[0]?.sent_at as Date | string | undefined;
    if (!row) return true;
    return Date.now() - new Date(row as unknown as string).getTime() > halfGapMs;
  } catch {
    return false;
  }
}

export async function markAlerted(route: string): Promise<boolean> {
  if (!(await ensure())) return false;
  try {
    await sql!`
      insert into cron_alerts (name, sent_at) values (${route}, now())
      on conflict (name) do update set sent_at = now()
    `;
    return true;
  } catch {
    return false;
  }
}
