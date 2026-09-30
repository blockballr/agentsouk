// the grid agent's PancakeSwap mode: a pair and a width stand in for the two prices,
// read from the deepest mainnet pool at one block, and the answer names that pool and
// block; nothing here touches a chain, a stand-in reader plays the pools
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parsePair, priceFromSqrt, supportedPairs } from "../src/lib/pancake";
import { clearPancakeCache, readPancakePrice, type PoolReader } from "../src/lib/pancake-read";
import { decideGridAgentTaskLive } from "../src/lib/reference-grid-live";

// WBNB/USDT 0.05% on BNB Chain mainnet, read on 30 Sep 2026; USDT sorts first, so WBNB is token1
const SQRT = BigInt("2873933985273352576414902182");
const EXPECTED_WBNB_IN_USDT = 1 / (Number(SQRT) / 2 ** 96) ** 2;
const BLOCK = BigInt(63_000_000);

type StubReader = PoolReader & { calls: string[]; blocks: bigint[] };

function reader(pools: Record<number, { pool: `0x${string}`; liquidity: bigint }>, sqrt = SQRT): StubReader {
  const calls: string[] = [];
  const blocks: bigint[] = [];
  return {
    calls,
    blocks,
    blockNumber: async () => {
      calls.push("blockNumber");
      return BLOCK;
    },
    getPool: async (_a, _b, fee, block) => {
      calls.push(`getPool:${fee}`);
      blocks.push(block);
      return pools[fee]?.pool ?? "0x0000000000000000000000000000000000000000";
    },
    liquidity: async (pool, block) => {
      blocks.push(block);
      return Object.values(pools).find((p) => p.pool === pool)?.liquidity ?? BigInt(0);
    },
    slot0: async (_pool, block) => {
      blocks.push(block);
      return { sqrtPriceX96: sqrt, tick: -66337 };
    },
  };
}

const DEEP = "0x36696169c63e42cd08ce11f5deebbcebae652050" as const;
const SHALLOW = "0x172fcd41e0913e95784454622d1c3724f546f849" as const;
const POOLS = { 100: { pool: SHALLOW, liquidity: BigInt(5) }, 500: { pool: DEEP, liquidity: BigInt(900) } };
const ORDER = { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 };

beforeEach(() => clearPancakeCache());

describe("pancake price maths", () => {
  it("reads the base price from sqrtPriceX96, inverting when the base sorts second", () => {
    expect(priceFromSqrt(SQRT, 18, 18, false)).toBeCloseTo(EXPECTED_WBNB_IN_USDT, 6);
    expect(priceFromSqrt(SQRT, 18, 18, true)).toBeCloseTo(1 / EXPECTED_WBNB_IN_USDT, 10);
  });

  it("scales by the decimals gap, as for an 18 decimal token against a 6 decimal dollar", () => {
    // 600 dollars per token: token1 per token0 in raw units is 600e-12
    const sqrt = BigInt(Math.round(Math.sqrt(600e-12) * 2 ** 96));
    expect(priceFromSqrt(sqrt, 18, 6, true)).toBeCloseTo(600, 6);
  });

  it("parses a pair, reads BNB as WBNB, and offers only pairs priced in dollars", () => {
    expect(parsePair("WBNB/USDT")).toEqual({ base: "WBNB", quote: "USDT" });
    expect(parsePair("plan it on bnb-usdt please")).toEqual({ base: "WBNB", quote: "USDT" });
    expect(parsePair("USDT/USDT")).toBeNull();
    expect(parsePair("WBNB USDT")).toBeNull();
    expect(supportedPairs(56)).toEqual(["WBNB/USDT"]);
  });
});

describe("reading a PancakeSwap pool", () => {
  it("takes the deepest tier, skips missing and empty pools, and pins every read to one block", async () => {
    const r = reader(POOLS);
    const q = await readPancakePrice(56, "WBNB", "USDT", { reader: r });
    expect(q).toMatchObject({ pool: DEEP, feeTier: 500, blockNumber: 63_000_000, pair: "WBNB/USDT", tick: -66337 });
    if ("price" in q) expect(q.price).toBeCloseTo(EXPECTED_WBNB_IN_USDT, 6);
    expect(r.calls.filter((c) => c.startsWith("getPool")).sort()).toEqual(["getPool:100", "getPool:10000", "getPool:2500", "getPool:500"]);
    expect(new Set(r.blocks)).toEqual(new Set([BLOCK]));
  });

  it("refuses an unknown pair, a pair not priced in dollars, and an unknown fee tier", async () => {
    expect(await readPancakePrice(56, "CAKE", "USDT", { reader: reader({}) })).toHaveProperty("error");
    expect(await readPancakePrice(56, "USDT", "WBNB", { reader: reader(POOLS) })).toHaveProperty("error");
    expect(await readPancakePrice(56, "WBNB", "USDT", { feeTier: 300, reader: reader(POOLS) })).toHaveProperty("error");
  });

  it("turns a failed read into an error rather than a price", async () => {
    const broken: PoolReader = { ...reader({}), blockNumber: async () => { throw new Error("rpc down\nstack"); } };
    expect(await readPancakePrice(56, "WBNB", "USDT", { reader: broken })).toEqual({
      error: "Could not read PancakeSwap on chain 56: rpc down",
    });
  });

  it("gives up at the deadline instead of hanging a paid delivery", async () => {
    const stuck: PoolReader = { ...reader(POOLS), blockNumber: () => new Promise<bigint>(() => {}) };
    const q = await readPancakePrice(56, "WBNB", "USDT", { reader: stuck, deadlineMs: 50 });
    expect(q).toEqual({ error: "Could not read PancakeSwap on chain 56: no answer within 0.05 seconds" });
  });

  it("answers a repeat within the cache window without reading again", async () => {
    const r = reader(POOLS);
    await readPancakePrice(56, "WBNB", "USDT", { reader: r });
    await readPancakePrice(56, "WBNB", "USDT", { reader: r });
    expect(r.calls.filter((c) => c === "blockNumber")).toHaveLength(1);
  });
});

describe("the grid agent's PancakeSwap mode", () => {
  it("centres the ladder on the mainnet price by default and states the pool and block", async () => {
    const reply = await decideGridAgentTaskLive("", { input: ORDER }, { reader: reader(POOLS) });
    expect(reply.state).toBe("completed");
    const inputs = reply.artifact.inputs as Record<string, number>;
    const source = reply.artifact.source as { price: number; chainId: number };
    expect(source.chainId).toBe(56);
    expect(source.price).toBeCloseTo(EXPECTED_WBNB_IN_USDT, 5);
    expect(inputs.lowerUsd).toBeCloseTo(source.price * 0.95, 5);
    expect(inputs.upperUsd).toBeCloseTo(source.price * 1.05, 5);
    // two swaps at the 0.05% tier
    expect(inputs.feeBps).toBe(10);
    expect(reply.text).toContain("PancakeSwap v3 WBNB/USDT price");
    expect(reply.text).toContain(`pool ${DEEP} at block 63000000 on BNB Chain mainnet`);
    expect(reply.text).not.toContain("with no market data");
  });

  it("reads the pair and width from plain text, and keeps a fee the caller names", async () => {
    const reply = await decideGridAgentTaskLive(
      "Plan a grid on WBNB/USDT 10% wide, levels 11, order size 100, fee bps 30",
      undefined,
      { reader: reader(POOLS) },
    );
    expect(reply.state).toBe("completed");
    expect((reply.artifact.inputs as Record<string, number>).feeBps).toBe(30);
    expect((reply.artifact.source as { feeFromPool: boolean }).feeFromPool).toBe(false);
  });

  it("accepts a width written with a percent sign and ignores an empty bound", async () => {
    const reply = await decideGridAgentTaskLive("", { ...ORDER, widthPct: "10%", lowerUsd: null }, { reader: reader(POOLS) });
    expect(reply.state).toBe("completed");
  });

  it("checks every input before reading the chain", async () => {
    const r = reader(POOLS);
    const reply = await decideGridAgentTaskLive("", { pair: "WBNB/USDT", widthPct: 10 }, { reader: r });
    expect(reply.state).toBe("input-required");
    expect(reply.artifact.missing).toEqual(["levels", "orderSizeUsd"]);
    expect(reply.text).toContain("or send lowerUsd and upperUsd instead");
    expect(r.calls).toEqual([]);
  });

  it("asks for a width rather than guessing one", async () => {
    const r = reader(POOLS);
    const reply = await decideGridAgentTaskLive("", { pair: "WBNB/USDT", levels: 11, orderSizeUsd: 100 }, { reader: r });
    expect(reply.artifact.missing).toEqual(["widthPct"]);
    expect(r.calls).toEqual([]);
  });

  it("refuses a reversed pair and a pair it does not know, naming the one it takes", async () => {
    for (const pair of ["USDT/WBNB", "ETH/USDT"]) {
      const r = reader(POOLS);
      const reply = await decideGridAgentTaskLive("", { ...ORDER, pair }, { reader: r });
      expect(reply.state).toBe("input-required");
      expect(reply.artifact.problems).toContain("pair must be WBNB/USDT, with the dollar token second");
      expect(r.calls).toEqual([]);
    }
  });

  it("leaves a question that only mentions a pair to the plain planner", async () => {
    const r = reader(POOLS);
    const reply = await decideGridAgentTaskLive("what is the BNB/USDT price today?", undefined, { reader: r });
    expect(reply.state).toBe("completed");
    expect(reply.artifact.status).toBe("ok");
    expect(r.calls).toEqual([]);
  });

  it("falls back to asking for prices when the pool cannot be read", async () => {
    const reply = await decideGridAgentTaskLive("", ORDER, { reader: reader({}) });
    expect(reply.state).toBe("input-required");
    expect(reply.text).toContain("I could not read the PancakeSwap price");
    expect(reply.text).toContain("or send lowerUsd and upperUsd instead");
  });

  it("plans from given prices and never reads the pool when the caller names them", async () => {
    const r = reader(POOLS);
    const reply = await decideGridAgentTaskLive("", { ...ORDER, lowerUsd: 1000, upperUsd: 2000 }, { reader: r });
    expect(reply.state).toBe("completed");
    expect(reply.artifact.source).toBeUndefined();
    expect(reply.text).toContain("Grid plan for a range of 1000 USD to 2000 USD");
    expect(r.calls).toEqual([]);
  });
});
