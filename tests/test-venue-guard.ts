// The venue guard reads the exit, not the rate: a frozen reserve, a collapsed
// rate, or liquidity too thin for the position is a reason to leave, and the
// same reading blocks new entry until it clears.
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { DEFAULT_VENUE_GUARD, decideVenueGuard, readAaveReserveRisk, type VenueRisk } from "../src/lib/venue-risk";

const E18 = 1_000_000_000_000_000_000n;

function risk(over: Partial<VenueRisk> = {}): VenueRisk {
  return {
    availableLiquidity: 1_000_000n * E18,
    supplied: 100n * E18,
    frozen: false,
    paused: false,
    rateBps: 307,
    blockNumber: 1,
    ...over,
  };
}

describe("venue guard", () => {
  it("clears a reserve that is open, liquid and paying", () => {
    expect(decideVenueGuard(risk()).action).toBe("clear");
  });

  it("pulls a supplied position when the reserve is frozen", () => {
    const out = decideVenueGuard(risk({ frozen: true }));
    expect(out.action).toBe("pull");
    expect(out.reason).toContain("frozen");
  });

  it("blocks entry when the reserve is paused and nothing is supplied", () => {
    const out = decideVenueGuard(risk({ paused: true, supplied: 0n }), DEFAULT_VENUE_GUARD, 50n * E18);
    expect(out.action).toBe("block");
    expect(out.reason).toContain("paused");
  });

  it("pulls when the rate collapses under the floor", () => {
    const out = decideVenueGuard(risk({ rateBps: 50 }));
    expect(out.action).toBe("pull");
    expect(out.reason).toContain("below the 1% floor");
  });

  it("pulls when liquidity falls under twice the position", () => {
    const out = decideVenueGuard(risk({ availableLiquidity: 150n * E18, supplied: 100n * E18 }));
    expect(out.action).toBe("pull");
    expect(out.reason).toContain("below 2x");
  });

  it("does not pull at exactly twice the position", () => {
    const out = decideVenueGuard(risk({ availableLiquidity: 200n * E18, supplied: 100n * E18 }));
    expect(out.action).toBe("clear");
  });

  it("blocks a new deposit unless liquidity is three times the size", () => {
    const out = decideVenueGuard(
      risk({ supplied: 0n, availableLiquidity: 250n * E18 }),
      DEFAULT_VENUE_GUARD,
      100n * E18,
    );
    expect(out.action).toBe("block");
    expect(out.reason).toContain("3x");

    const roomy = decideVenueGuard(
      risk({ supplied: 0n, availableLiquidity: 300n * E18 }),
      DEFAULT_VENUE_GUARD,
      100n * E18,
    );
    expect(roomy.action).toBe("clear");
  });
});

// the policy takes a reading; this pins the mapping from Aave's own struct to
// that reading, which is where a wrong index would silently invert a flag
function fakeAave(input: {
  active?: boolean;
  frozen?: boolean;
  rateBps?: number;
  available?: bigint;
}): PublicClient {
  const ATOKEN = "0x2222222222222222222222222222222222222222";
  const DATA_PROVIDER = "0x3333333333333333333333333333333333333333";
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "getPoolDataProvider") return DATA_PROVIDER;
      if (functionName === "getReserveData") {
        const row = new Array(15).fill(0n);
        // rate is a ray; 307 bps is 3.07 percent a year
        row[2] = BigInt(input.rateBps ?? 307) * 10n ** 23n;
        row[8] = ATOKEN;
        return row;
      }
      if (functionName === "getReserveConfigurationData") {
        const row = new Array(10).fill(false);
        row[8] = input.active ?? true;
        row[9] = input.frozen ?? false;
        return row;
      }
      if (functionName === "balanceOf") return input.available ?? 1_000_000n * E18;
      throw new Error(`unexpected call ${functionName}`);
    },
  } as unknown as PublicClient;
}

describe("reading Aave's reserve", () => {
  const args = {
    pool: "0x4444444444444444444444444444444444444444" as const,
    asset: "0x5555555555555555555555555555555555555555" as const,
    provider: "0x6666666666666666666666666666666666666666" as const,
    supplied: 100n * E18,
    blockNumber: 1n,
  };

  it("maps a healthy reserve to clear and reads the rate in basis points", async () => {
    const reading = await readAaveReserveRisk(fakeAave({}), args);
    expect(reading.frozen).toBe(false);
    expect(reading.paused).toBe(false);
    expect(reading.rateBps).toBe(307);
    expect(decideVenueGuard(reading).action).toBe("clear");
  });

  it("maps a frozen reserve to pull", async () => {
    const reading = await readAaveReserveRisk(fakeAave({ frozen: true }), args);
    expect(reading.frozen).toBe(true);
    expect(decideVenueGuard(reading).action).toBe("pull");
  });

  it("maps an inactive reserve to paused and pull", async () => {
    const reading = await readAaveReserveRisk(fakeAave({ active: false }), args);
    expect(reading.paused).toBe(true);
    expect(decideVenueGuard(reading).action).toBe("pull");
  });

  it("maps thin liquidity to pull", async () => {
    const reading = await readAaveReserveRisk(fakeAave({ available: 150n * E18 }), args);
    expect(reading.availableLiquidity).toBe(150n * E18);
    expect(decideVenueGuard(reading).action).toBe("pull");
  });
});
