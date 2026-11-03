import { afterEach, describe, expect, it } from "vitest";
import { bestVenue, defaultVenueFor } from "../src/lib/venue-select";
import type { Venue } from "../src/lib/venue-registry";

function venue(over: Partial<Venue>): Venue {
  return {
    id: "v",
    chainId: 56,
    name: "Venue",
    protocol: "Test",
    kind: "lending",
    asset: "0x55d398326f99059fF775485246999027B3197955",
    pool: "0x0000000000000000000000000000000000000001",
    receipt: "0x0000000000000000000000000000000000000002",
    rateBps: 100,
    rateAsOf: "2026-11-03",
    status: "live",
    note: "",
    ...over,
  };
}

const ADAPTER = "0x312c8570aef81f6c366adc4a79792ba7fe2f8a2c";

describe("best venue", () => {
  it("takes the highest live rate", () => {
    const best = bestVenue([
      venue({ id: "a", adapter: ADAPTER, rateBps: 307 }),
      venue({ id: "b", adapter: "0x0000000000000000000000000000000000000003", rateBps: 57 }),
    ]);
    expect(best?.id).toBe("a");
  });

  it("ignores a venue with no adapter", () => {
    const best = bestVenue([
      venue({ id: "candidate", status: "live", rateBps: 900 }),
      venue({ id: "live", adapter: ADAPTER, rateBps: 57 }),
    ]);
    expect(best?.id).toBe("live");
  });

  it("ignores a candidate even when it pays more", () => {
    const best = bestVenue([
      venue({ id: "candidate", status: "candidate", adapter: ADAPTER, rateBps: 900 }),
      venue({ id: "live", adapter: "0x0000000000000000000000000000000000000003", rateBps: 57 }),
    ]);
    expect(best?.id).toBe("live");
  });

  it("breaks a tie by id so the choice is stable", () => {
    const best = bestVenue([
      venue({ id: "z", adapter: ADAPTER, rateBps: 100 }),
      venue({ id: "a", adapter: "0x0000000000000000000000000000000000000003", rateBps: 100 }),
    ]);
    expect(best?.id).toBe("a");
  });

  it("returns null when nothing is live", () => {
    expect(bestVenue([venue({ id: "x", status: "candidate" })])).toBeNull();
  });
});

describe("default venue", () => {
  afterEach(() => {
    delete process.env.VENUE_ADDRESS_56;
  });

  it("honours an operator pin", () => {
    process.env.VENUE_ADDRESS_56 = "0x00000000000000000000000000000000000000aa";
    expect(defaultVenueFor(56)).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("falls back to the best live adapter on chain 56", () => {
    expect(defaultVenueFor(56)).toBeTruthy();
    expect(defaultVenueFor(56)).not.toBe("0x00000000000000000000000000000000000000aa");
  });

  it("keeps the mock venue on the testnet", () => {
    expect(defaultVenueFor(97)).toBe("0x6b81b6fff9f6920b309e511159f737454870f8e8");
  });
});
