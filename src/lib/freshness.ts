export type Freshness = "fresh" | "stale" | "dead";

export const FRESH_MS = 60_000;
export const STALE_MS = 300_000;

export interface FreshnessReading {
  state: Freshness;
  ageMs: number | null;
}

export function readFreshness(
  at: string | number | null | undefined,
  now: number = Date.now(),
  freshMs: number = FRESH_MS,
  staleMs: number = STALE_MS,
): FreshnessReading {
  const time = typeof at === "number" ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return { state: "dead", ageMs: null };
  const ageMs = Math.max(0, now - time);
  if (ageMs <= freshMs) return { state: "fresh", ageMs };
  if (ageMs <= staleMs) return { state: "stale", ageMs };
  return { state: "dead", ageMs };
}
