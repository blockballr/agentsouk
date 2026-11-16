import { describe, expect, it } from "vitest";
import { summarizeFluxPools } from "../src/lib/flux-summary";

describe("flux summary", () => {
  it("adds up what the pools report and names the best earner per dollar", () => {
    const summary = summarizeFluxPools({
      phase: "closed",
      readAt: "2026-11-16T08:00:42.709Z",
      pools: [
        { symbol: "NVDAB/USDT", tvlUsd: 1_000_000, flow: { volumeUsd: 3_000_000, feesUsd: 6_000, swaps: 700 } },
        { symbol: "MSFTB/USDT", tvlUsd: 50_000, flow: { volumeUsd: 70_000, feesUsd: 200, swaps: 60 } },
        { symbol: "SPYB/USDT", tvlUsd: 200_000, flow: { volumeUsd: 500_000, feesUsd: 50, swaps: 1_600 } },
      ],
    });
    expect(summary).toEqual({
      pools: 3,
      tvlUsd: 1_250_000,
      volume24hUsd: 3_570_000,
      fees24hUsd: 6_250,
      swaps24h: 2_360,
      topPool: { symbol: "NVDAB/USDT", feeTvlDay: 0.006 },
      ranked: [
        { symbol: "NVDAB/USDT", venue: null, tvlUsd: 1_000_000, fees24hUsd: 6_000, feeTvlDay: 0.006 },
        { symbol: "MSFTB/USDT", venue: null, tvlUsd: 50_000, fees24hUsd: 200, feeTvlDay: 0.004 },
        { symbol: "SPYB/USDT", venue: null, tvlUsd: 200_000, fees24hUsd: 50, feeTvlDay: 0.00025 },
      ],
      phase: "closed",
      readAt: "2026-11-16T08:00:42.709Z",
    });
  });

  it("counts nothing it was not given", () => {
    const summary = summarizeFluxPools({
      pools: [
        { symbol: "AAPLB/USDT", tvlUsd: 100, flow: null },
        { symbol: "TSLAB/USDT", tvlUsd: Number.NaN, flow: { feesUsd: -5, volumeUsd: "12" as unknown as number } },
      ],
    });
    expect(summary).toMatchObject({ pools: 2, tvlUsd: 100, volume24hUsd: 0, fees24hUsd: 0, swaps24h: 0, topPool: null, ranked: [], phase: null });
  });

  it("returns nothing for a body with no pools", () => {
    expect(summarizeFluxPools(null)).toBeNull();
    expect(summarizeFluxPools({ pools: [] })).toBeNull();
    expect(summarizeFluxPools({ error: "down" })).toBeNull();
  });
});
