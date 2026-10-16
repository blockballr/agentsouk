// The layer's cache is a cache: a state row round-trips as it was written, and
// the lease lets one runner hold a hire while another waits, expiring on the
// clock rather than on a release that never came.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});

vi.mock("server-only", () => ({}));

import {
  acquireLease,
  getStrategyState,
  releaseLease,
  saveStrategyState,
} from "../src/lib/strategy-store";

describe("state rows", () => {
  it("round-trips generation, block, price and keys", async () => {
    await saveStrategyState(97, "501", {
      generation: 2,
      lastBlock: 123456789n,
      lastPrice: 612.5,
      crossed: ["2:5:buyA", "2:6:buyA"],
    });
    const read = await getStrategyState(97, "501");
    expect(read).toEqual({
      generation: 2,
      lastBlock: 123456789n,
      lastPrice: 612.5,
      crossed: ["2:5:buyA", "2:6:buyA"],
    });
  });

  it("reads a never-written hire as null", async () => {
    expect(await getStrategyState(97, "502")).toBeNull();
  });
});

describe("the lease", () => {
  it("holds a hire against a second runner and releases it back", async () => {
    expect(await acquireLease(97, "503", "runner-a", 60_000)).toBe(true);
    expect(await acquireLease(97, "503", "runner-b", 60_000)).toBe(false);
    await releaseLease(97, "503", "runner-a");
    expect(await acquireLease(97, "503", "runner-b", 60_000)).toBe(true);
  });

  it("lets a stale lease expire on its ttl", async () => {
    const t0 = Date.now();
    expect(await acquireLease(97, "504", "runner-a", 1_000, t0)).toBe(true);
    expect(await acquireLease(97, "504", "runner-b", 1_000, t0 + 1_500)).toBe(true);
  });

  it("ignores a release from a holder that does not hold it", async () => {
    expect(await acquireLease(97, "505", "runner-a", 60_000)).toBe(true);
    await releaseLease(97, "505", "runner-x");
    expect(await acquireLease(97, "505", "runner-b", 60_000)).toBe(false);
  });
});
