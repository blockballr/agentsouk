// running a skill: the caller's inputs are read strictly, the only way out is the reader
// handed in, and the answer is the blueprint's own sentence with the blocks' figures in it
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateBlueprint, type Blueprint } from "../src/lib/builder/blueprint";
import { checkExamples, readInputs, runSkill, type DataReader } from "../src/lib/builder/run";
import { liveReader } from "../src/lib/builder/sources";
import { clearPancakeCache, type PoolReader } from "../src/lib/pancake-read";
import samples from "./fixtures/builder-samples.json";

function sample(name: keyof typeof samples): Blueprint {
  const check = validateBlueprint(samples[name]);
  if (!check.ok) throw new Error(check.errors.join("; "));
  return check.blueprint;
}

// WBNB/USDT 0.05% on BSC testnet; USDT sorts first, so WBNB, the base, is token1
const POOL = {
  chainId: 97,
  pair: "WBNB/USDT",
  pool: "0x0000000000000000000000000000000000000abc",
  feeTier: 500,
  tick: -22900,
  liquidity: "1000",
  price: 9.885312,
  blockNumber: 123,
  sqrtPriceX96: "25198607551688324341071279158",
  tickSpacing: 10,
  baseIsToken0: false,
  decimals0: 18,
  decimals1: 18,
};

const fakeRead: DataReader = async (source, args) =>
  source === "pancakeswap.v3.pool" && args.pair === "WBNB/USDT" ? { ...POOL } : { error: `${String(args.pair)} is not a supported PancakeSwap pair` };

describe("reading a caller's inputs", () => {
  const skill = sample("healthWatcher").skills[0];

  it("takes numbers as people write them and leaves optional ones out", () => {
    expect(readInputs(skill, { collateral: "$10,000", debt: 6500 })).toEqual({
      values: { collateral: 10000, debt: 6500 },
      missing: [],
      problems: [],
    });
    expect(readInputs(skill, { collateral: 1, debt: 1, threshold: "80%" }).values.threshold).toBe(80);
  });

  it("names what is missing and what cannot be read, and guesses nothing", () => {
    expect(readInputs(skill, { collateral: "a lot" })).toEqual({
      values: {},
      missing: ["debt"],
      problems: ["collateral must be a number"],
    });
    expect(readInputs(skill, undefined).missing).toEqual(["collateral", "debt"]);
    expect(readInputs(skill, { collateral: [1000], debt: { usd: 5 } }).problems).toEqual([
      "collateral must be a number",
      "debt must be a number",
    ]);
  });

  it("refuses a number too large to do arithmetic on", () => {
    expect(readInputs(skill, { collateral: `1${"0".repeat(308)}`, debt: 1 }).problems).toEqual(["collateral must be a number"]);
    expect(readInputs(skill, { collateral: 1e16, debt: -1e16 }).problems).toEqual([
      "collateral is out of range",
      "debt is out of range",
    ]);
    expect(readInputs(skill, { collateral: 1e15, debt: 1 }).problems).toEqual([]);
  });

  it("does not take an inherited member for a value the caller never sent", () => {
    const odd = { id: "constructor", label: "Builder", type: "text" as const, required: false, description: "who built it" };
    expect(readInputs({ ...skill, inputs: [...skill.inputs, odd] }, { collateral: 1000, debt: 500 })).toEqual({
      values: { collateral: 1000, debt: 500 },
      missing: [],
      problems: [],
    });
  });
});

describe("the health factor watcher", () => {
  const skill = sample("healthWatcher").skills[0];

  it("answers its own example with the figures worked by hand", async () => {
    const run = await runSkill(skill, skill.example);
    expect(run.state).toBe("completed");
    expect(run.text).toBe(
      "Health factor 1.2308 (caution) for collateral 10000 USD and debt 6500 USD. Collateral can fall 18.75% before liquidation, and the position can take 1500.00 USD more debt.",
    );
    expect(run.steps.hf).toMatchObject({ healthFactor: 1.2308, state: "caution", liquidationCapacityUsd: 8000 });
  });

  it("says a figure does not apply rather than printing an empty one", async () => {
    const run = await runSkill(skill, { collateral: 1000, debt: 0 });
    expect(run.state).toBe("completed");
    expect(run.text).toContain("Health factor not applicable (no-debt)");
    expect(run.text).toContain("Collateral can fall not applicable% before liquidation");
  });

  it("asks for what is missing and runs nothing", async () => {
    const run = await runSkill(skill, { collateral: 1000 });
    expect(run).toMatchObject({ state: "input-required", missing: ["debt"], text: "", steps: {} });
  });

  it("reports a value the block refuses in the caller's own word for it", async () => {
    const run = await runSkill(skill, { collateral: 1000, debt: 500, threshold: 80 });
    expect(run.state).toBe("input-required");
    expect(run.problems).toEqual(["threshold must be a fraction above 0 and at most 1"]);
    const zero = await runSkill(skill, { collateral: 0, debt: 500 });
    expect(zero.problems).toEqual(["collateral must be a number above 0"]);
  });

  it("gives no figure when the arithmetic overflows, rather than printing Infinity", async () => {
    const run = await runSkill(skill, { collateral: 1e15, debt: 1e-320 });
    expect(run).toMatchObject({ state: "failed", text: "", problems: ["health-factor could not be computed from these values"] });
  });
});

describe("the yield comparer", () => {
  const skill = sample("yieldComparer").skills[0];

  it("feeds one step's result into the next and names the better option", async () => {
    const run = await runSkill(skill, skill.example);
    expect(run.state).toBe("completed");
    expect(run.text).toBe(
      "Option A nets 7.8% a year, 780.00 USD on 10000 USD. Option B nets 7.9248%, 792.48 USD. The better one is option B, by 0.1248 percentage points.",
    );
  });

  it("stops plainly when a step needs a figure an earlier step left empty", async () => {
    const chained = sample("healthWatcher").skills[0];
    chained.inputs.push({ id: "target", label: "Target", type: "number", required: true, description: "health factor to compare against" });
    chained.steps.push({ id: "gap", block: "compare-two", args: { first: { ref: "input.target" }, second: { ref: "hf.healthFactor" } } });
    const withDebt = await runSkill(chained, { collateral: 1000, debt: 500, target: 2 });
    expect(withDebt.steps.gap).toEqual({ higher: "the first", difference: 0.4 });
    // no debt means no health factor, and nothing the caller could send would supply one
    const noDebt = await runSkill(chained, { collateral: 1000, debt: 0, target: 2 });
    expect(noDebt).toMatchObject({ state: "failed", text: "", problems: ["hf.healthFactor has no value for these inputs"] });
  });

  it("treats a missing fee as no fee", async () => {
    const run = await runSkill(skill, { principal: 1000, apyA: 12, apyB: 12 });
    expect(run.steps.pick).toEqual({ higher: "equal", difference: 0 });
    expect(run.steps.a.netRatePercent).toBe(12.6825);
  });
});

describe("the PancakeSwap range planner", () => {
  const skill = sample("rangePlanner").skills[0];

  it("reads the pool through the reader it is given and plans around that price", async () => {
    const read = vi.fn(fakeRead);
    const run = await runSkill(skill, skill.example, { read });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("pancakeswap.v3.pool", { pair: "WBNB/USDT" });
    expect(run.state).toBe("completed");
    expect(run.text).toMatch(
      /^WBNB is at 9\.89 USDT at block 123\. A 10% range runs from 9\.\d\d to 10\.\d\d USDT, ticks -?\d+ to -?\d+\. The deposit splits into \d\.\d+ WBNB and \d+\.\d+ USDT\.$/,
    );
    // only the fields the source declares are kept, never the raw record
    expect(run.reads.pool).toEqual({ price: 9.885312, feeTier: 500, blockNumber: 123, pool: POOL.pool });
    const r = run.steps.range as Record<string, number>;
    expect(r.quoteAmount + r.baseAmount * r.priceNow).toBeCloseTo(100, 1);
  });

  it("fails plainly, with no figure, when there is no reader or the read fails", async () => {
    const none = await runSkill(skill, skill.example);
    expect(none).toMatchObject({ state: "failed", readFailed: true, text: "", problems: ["the pancakeswap.v3.pool data source is not available"] });

    const down = await runSkill(skill, skill.example, { read: async () => ({ error: "Could not read PancakeSwap on chain 97: no answer within 6 seconds" }) });
    expect(down).toMatchObject({ state: "failed", readFailed: true, text: "", steps: {} });

    const thrown = await runSkill(skill, skill.example, { read: async () => { throw new Error("socket hang up"); } });
    // what a reader threw is ours to log, not the caller's to read
    expect(thrown).toMatchObject({ state: "failed", readFailed: true, problems: ["the pancakeswap.v3.pool data source could not be read"] });
  });

  it("refuses a range so wide its lower edge is a price of zero", async () => {
    const run = await runSkill(skill, { widthPercent: 200, deposit: 100 }, { read: fakeRead });
    expect(run).toMatchObject({ state: "input-required", text: "", problems: ["widthPercent must be above 0 and at most 100"] });
  });
});

describe("proving a blueprint by its own examples", () => {
  it("passes the three samples", async () => {
    for (const name of ["healthWatcher", "rangePlanner", "yieldComparer"] as const) {
      expect(await checkExamples(sample(name), { read: fakeRead })).toEqual({ errors: [], unavailable: [] });
    }
  });

  it("names the skill whose example gives no answer", async () => {
    const bp = sample("healthWatcher");
    bp.skills[0].example = { collateral: 0, debt: 10 };
    expect(await checkExamples(bp)).toEqual({
      errors: ["skills[0].example: does not produce an answer (collateral must be a number above 0)"],
      unavailable: [],
    });
  });

  it("keeps a failed read apart from a fault in the blueprint", async () => {
    const down: DataReader = async () => ({ error: "Could not read PancakeSwap on chain 97: no answer within 6 seconds" });
    expect(await checkExamples(sample("rangePlanner"), { read: down })).toEqual({
      errors: [],
      unavailable: ["skills[0]: Could not read PancakeSwap on chain 97: no answer within 6 seconds"],
    });
  });
});

describe("the live reader", () => {
  const chain: PoolReader = {
    blockNumber: async () => BigInt(123),
    getPool: async (_a, _b, fee) => (fee === 500 ? "0x0000000000000000000000000000000000000abc" : "0x0000000000000000000000000000000000000000"),
    liquidity: async () => BigInt(1000),
    slot0: async () => ({ sqrtPriceX96: BigInt(POOL.sqrtPriceX96), tick: -22900 }),
    tickSpacing: async () => 10,
  };

  it("reads only the approved source, and only a pair it can parse", async () => {
    clearPancakeCache();
    const read = liveReader(97, { reader: chain });
    expect(await read("coingecko.price", { id: "bnb" })).toEqual({ error: "coingecko.price is not an approved data source" });
    expect(await read("pancakeswap.v3.pool", { pair: "DOGE/USDT" })).toEqual({
      error: "pair must be written base/quote, for example WBNB/USDT",
    });
    const quote = await read("pancakeswap.v3.pool", { pair: "bnb-usdt" });
    expect(quote).toMatchObject({ pair: "WBNB/USDT", feeTier: 500, blockNumber: 123, sqrtPriceX96: POOL.sqrtPriceX96 });
  });

  it("gives the range planner an answer end to end", async () => {
    clearPancakeCache();
    const skill = sample("rangePlanner").skills[0];
    const run = await runSkill(skill, { widthPercent: 20 }, { read: liveReader(97, { reader: chain }) });
    expect(run.state).toBe("completed");
    expect(run.text).toContain("The deposit splits into not applicable WBNB and not applicable USDT.");
    expect(run.text).toContain("A 20% range runs from");
  });
});
