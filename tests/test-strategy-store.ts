// The layer's cache is a cache: a state row round-trips as it was written. The
// per-hire lease lives in lease-store.ts, shared with the health watch.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});

vi.mock("server-only", () => ({}));

import { getStrategyState, saveStrategyState } from "../src/lib/strategy-store";

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
