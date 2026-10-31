export type Freshness = "fresh" | "stale" | "dead";

const FRESH_MS = 60_000;
const STALE_MS = 300_000;

export interface FreshnessReading {
  state: Freshness;
  ageMs: number | null;
}

export function readFreshness(
  at: string | number | null | undefined,
  now: number = Date.now(),
): FreshnessReading {
  const time = typeof at === "number" ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return { state: "dead", ageMs: null };
  const ageMs = Math.max(0, now - time);
  if (ageMs <= FRESH_MS) return { state: "fresh", ageMs };
  if (ageMs <= STALE_MS) return { state: "stale", ageMs };
  return { state: "dead", ageMs };
}
