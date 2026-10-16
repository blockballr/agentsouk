// The sweep is the runner: it feeds the layer the hire, the pool's price mark
// and the cache, and reports one line per intent it raised. A dry run sends
// nothing and says what it would have done; the kill switch turns every
// decision into a no-op; a held lease and a failed price read each stop the row
// before anything is chosen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.VAULT_EXECUTE;
  delete process.env.VAULT_KILL;
  delete process.env.GRID_STRATEGY_WIDTH_PCT;
  delete process.env.GRID_STRATEGY_LEVELS;
});

vi.mock("server-only", () => ({}));

vi.mock("../src/lib/pancake-read", () => ({
  readPancakePrice: vi.fn(),
}));

import type { PublicClient } from "viem";
import { readPancakePrice } from "../src/lib/pancake-read";
import { sweepOwnHires } from "../src/lib/vault-executor";
import { acquireLease, saveStrategyState } from "../src/lib/strategy-store";

const AGENT = "0x52DA44aB471455437fc17979c52E501f6b8d0EAF";
const BUYER = "0x84fedaBd1b83443aD86796C15619494878B64180";
const VAULT = "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8";
const Q96 = 2n ** 96n;
const EXPIRY = Math.floor(Date.now() / 1000) + 3600;

function hireTuple(over: Partial<Record<number, unknown>> = {}): unknown[] {
  const row: unknown[] = [
    BUYER,
    AGENT,
    EXPIRY,
    100, // maxSlippageBps
    true, // open
    110n, // balanceA
    110n, // balanceB
    600n * Q96, // refPriceX96: rungs 570..630 in steps of 6
    500, // fee
    1n, // depositInToken0
  ];
  for (const [k, v] of Object.entries(over)) row[Number(k)] = v;
  return row;
}

function fakeClient(ids: bigint[], tuple: unknown[]): PublicClient {
  return {
    readContract: vi.fn(async (args: { functionName: string }) =>
      args.functionName === "hiresFor" ? ids : tuple,
    ),
  } as unknown as PublicClient;
}

function fakeActor(impl?: (call: { to: string; data: string }) => Promise<string>) {
  const trade = vi.fn(impl ?? (async (_call: { to: string; data: string }) => "0xfeed"));
  return { actor: { address: async () => AGENT, trade } as never, trade };
}

function mark(price: number, blockNumber: number) {
  vi.mocked(readPancakePrice).mockResolvedValue({
    price,
    blockNumber,
    chainId: 97,
    pair: "WBNB/USDT",
    pool: "0xpool",
    feeTier: 500,
    tick: 0,
  } as never);
}

beforeEach(() => {
  vi.mocked(readPancakePrice).mockReset();
  mark(590, 200);
});

afterEach(() => {
  delete process.env.VAULT_KILL;
});

describe("the sweep on one open hire", () => {
  it("reports the intents it would send and sends nothing on a dry run", async () => {
    await saveStrategyState(97, "7", {
      generation: 0,
      lastBlock: 100n,
      lastPrice: 620,
      crossed: [],
    });
    const { actor, trade } = fakeActor();

    const reports = await sweepOwnHires(fakeClient([7n], hireTuple()), 97, actor, 5, () => false, false);

    // a fall from 620 to 590 crosses five rungs
    expect(reports).toHaveLength(5);
    for (const row of reports) {
      expect(row.status).toBe("skipped");
      expect(row.reason).toMatch(/^dry run: would buyA 10 of token B/);
      expect(row.buyer).toBe(BUYER);
      expect(row.amountIn).toBe("10");
    }
    reports.forEach((row, i) => expect(row.rungPrice).toBeCloseTo([594, 600, 606, 612, 618][i]));
    expect(trade).not.toHaveBeenCalled();
  });

  it("never decides the same block twice", async () => {
    await saveStrategyState(97, "8", {
      generation: 0,
      lastBlock: 100n,
      lastPrice: 620,
      crossed: [],
    });
    const { actor, trade } = fakeActor();
    const client = fakeClient([8n], hireTuple());

    await sweepOwnHires(client, 97, actor, 5, () => false, false);
    const second = await sweepOwnHires(client, 97, actor, 5, () => false, false);

    expect(second).toHaveLength(1);
    expect(second[0].reason).toContain("already decided");
    expect(trade).not.toHaveBeenCalled();
  });

  it("turns every decision into a no-op while the kill switch is thrown", async () => {
    process.env.VAULT_KILL = "1";
    const { actor, trade } = fakeActor();

    const reports = await sweepOwnHires(fakeClient([9n], hireTuple()), 97, actor, 5, () => false, true);

    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("skipped");
    expect(reports[0].reason).toContain("kill switch");
    expect(trade).not.toHaveBeenCalled();
  });

  it("sends each intent at the vault when execution is on", async () => {
    await saveStrategyState(97, "10", {
      generation: 0,
      lastBlock: 100n,
      lastPrice: 620,
      crossed: [],
    });
    const { actor, trade } = fakeActor();

    const reports = await sweepOwnHires(fakeClient([10n], hireTuple()), 97, actor, 5, () => false, true);

    expect(reports.filter((r) => r.status === "traded")).toHaveLength(5);
    expect(trade).toHaveBeenCalledTimes(5);
    const first = trade.mock.calls[0][0] as { to: string; data: string };
    expect(first.to).toBe(VAULT);
    expect(first.data.startsWith("0x")).toBe(true);
  });

  it("stops a hire's intents at the first refusal, the contract being the last line", async () => {
    await saveStrategyState(97, "11", {
      generation: 0,
      lastBlock: 100n,
      lastPrice: 620,
      crossed: [],
    });
    const { actor, trade } = fakeActor(async () => {
      throw new Error("BelowFloor()");
    });

    const reports = await sweepOwnHires(fakeClient([11n], hireTuple()), 97, actor, 5, () => false, true);

    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("refused");
    expect(reports[0].reason).toContain("BelowFloor");
    expect(trade).toHaveBeenCalledTimes(1);
  });

  it("skips a hire that is not open and one whose price mark failed", async () => {
    const closed = await sweepOwnHires(
      fakeClient([12n], hireTuple({ 4: false })),
      97,
      fakeActor().actor,
      5,
      () => false,
      false,
    );
    expect(closed[0].reason).toBe("not open");

    vi.mocked(readPancakePrice).mockResolvedValue({ error: "the pool did not answer" } as never);
    const unreadable = await sweepOwnHires(
      fakeClient([13n], hireTuple()),
      97,
      fakeActor().actor,
      5,
      () => false,
      false,
    );
    expect(unreadable[0].reason).toContain("no price mark");
  });

  it("leaves a hire alone when another runner holds the lease", async () => {
    await acquireLease(97, "14", "another-runner", 60_000);
    const { actor, trade } = fakeActor();

    const reports = await sweepOwnHires(fakeClient([14n], hireTuple()), 97, actor, 5, () => false, true);

    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toContain("lease");
    expect(trade).not.toHaveBeenCalled();
  });
});
