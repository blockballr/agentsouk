// The headline figures for Flux LP, read from its own published pools. Only
// what the pools report is summed; a pool missing a figure adds nothing, and
// no number is ever filled in when the source has none.

export const FLUX_POOLS_URL = "https://fluxlp.agentsouk.xyz/pools";

interface PoolFlow {
  volumeUsd?: number;
  feesUsd?: number;
  swaps?: number;
}

export interface FluxPool {
  symbol?: string;
  tvlUsd?: number;
  flow?: PoolFlow | null;
}

export interface FluxPoolRow {
  symbol: string;
  venue: string | null;
  tvlUsd: number;
  fees24hUsd: number;
  /** fees over the day as a share of the pool's liquidity */
  feeTvlDay: number;
}

export interface FluxSummary {
  pools: number;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  swaps24h: number;
  /** the pool earning the most fees per dollar of liquidity over the day */
  topPool: { symbol: string; feeTvlDay: number } | null;
  /** every pool that earned fees, best earner per dollar first */
  ranked: FluxPoolRow[];
  /** the US market phase the snapshot was taken in */
  phase: string | null;
  readAt: string | null;
}

const finite = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function summarizeFluxPools(body: unknown): FluxSummary | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { pools?: unknown }).pools;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const pools = raw as FluxPool[];

  let tvlUsd = 0;
  let volume24hUsd = 0;
  let fees24hUsd = 0;
  let swaps24h = 0;
  let topPool: FluxSummary["topPool"] = null;
  const ranked: FluxPoolRow[] = [];
  for (const pool of pools) {
    const tvl = finite(pool.tvlUsd);
    const fees = finite(pool.flow?.feesUsd);
    tvlUsd += tvl;
    volume24hUsd += finite(pool.flow?.volumeUsd);
    fees24hUsd += fees;
    swaps24h += finite(pool.flow?.swaps);
    if (tvl > 0 && fees > 0 && typeof pool.symbol === "string") {
      const feeTvlDay = fees / tvl;
      if (!topPool || feeTvlDay > topPool.feeTvlDay) topPool = { symbol: pool.symbol, feeTvlDay };
      const venue = (pool as { venue?: unknown }).venue;
      ranked.push({ symbol: pool.symbol, venue: typeof venue === "string" ? venue : null, tvlUsd: tvl, fees24hUsd: fees, feeTvlDay });
    }
  }

  const meta = body as { phase?: unknown; readAt?: unknown };
  return {
    pools: pools.length,
    tvlUsd,
    volume24hUsd,
    fees24hUsd,
    swaps24h,
    topPool,
    ranked: ranked.sort((a, b) => b.feeTvlDay - a.feeTvlDay),
    phase: typeof meta.phase === "string" ? meta.phase : null,
    readAt: typeof meta.readAt === "string" ? meta.readAt : null,
  };
}
