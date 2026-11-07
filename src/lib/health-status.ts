// The watcher's own health, read from the run log rather than promised. A
// buyer-facing status has to distinguish three states: checking recently,
// failing repeatedly while still running, and silent for long enough that the
// position is undefended.

import "server-only";
import type { CronRun } from "./history-store";

export const WATCH_NAME = "health-watch";
export const WATCH_INTERVAL_MS = 10 * 60_000;
// two missed checks plus slack, so a slow scheduler run does not read as dead
export const WATCH_STALE_AFTER_MS = 3 * WATCH_INTERVAL_MS;

export interface WatchStatus {
  name: string;
  lastRunAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  stale: boolean;
  ok: boolean;
  consecutiveFailures: number;
  note: string | null;
  degraded: boolean;
}

export function watchStatus(runs: readonly CronRun[], now = Date.now()): WatchStatus {
  const ordered = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const last = ordered[0] ?? null;
  const ageMs = last ? Math.max(0, now - Date.parse(last.startedAt)) : null;
  const stale = ageMs === null || ageMs > WATCH_STALE_AFTER_MS;
  let consecutiveFailures = 0;
  for (const run of ordered) {
    if (run.ok) break;
    consecutiveFailures += 1;
  }
  return {
    name: WATCH_NAME,
    lastRunAt: last?.startedAt ?? null,
    ageMs,
    staleAfterMs: WATCH_STALE_AFTER_MS,
    stale,
    ok: last?.ok ?? false,
    consecutiveFailures,
    note: last?.note ?? null,
    degraded: stale || consecutiveFailures >= 2,
  };
}
