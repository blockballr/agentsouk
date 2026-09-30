// whether an agent's wallet uses PancakeSwap v3: positions held in the position manager and
// staked in the farm are counted apart, a repeat comes from the cache, and a slow or failed
// read says nothing rather than claiming zero
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PANCAKE_FARM_V3,
  PANCAKE_POSITION_MANAGER,
  POSITIONS_FAILURE_TTL_MS,
  clearPositionsCache,
  readPancakePositions,
  type PositionReader,
} from "../src/lib/pancake-positions";

const WALLET = "0x84fedabd1b83443ad86796c15619494878b64180";

function reader(held: number, staked: number): PositionReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    balanceOf: async (contract) => {
      calls.push(contract);
      return BigInt(contract === PANCAKE_POSITION_MANAGER[97] ? held : contract === PANCAKE_FARM_V3[97] ? staked : 0);
    },
  };
}

beforeEach(() => clearPositionsCache());

describe("PancakeSwap positions of a wallet", () => {
  it("counts held and staked positions apart and names the manager for the proof link", async () => {
    const p = await readPancakePositions(97, WALLET, { reader: reader(2, 1) });
    expect(p).toMatchObject({ wallet: WALLET, held: 2, staked: 1, positionManager: PANCAKE_POSITION_MANAGER[97] });
  });

  it("reads each wallet once within the cache window", async () => {
    const r = reader(1, 0);
    await readPancakePositions(97, WALLET, { reader: r });
    await readPancakePositions(97, WALLET.toUpperCase().replace("0X", "0x"), { reader: r });
    expect(r.calls).toHaveLength(2);
  });

  it("returns nothing, not zero, when the chain is slow", async () => {
    const stuck: PositionReader = { balanceOf: () => new Promise<bigint>(() => {}) };
    expect(await readPancakePositions(97, WALLET, { reader: stuck, deadlineMs: 30 })).toBeNull();
  });

  it("skips a malformed wallet, the zero address and a chain it does not cover without calling out", async () => {
    const r = reader(1, 1);
    expect(await readPancakePositions(97, "not-a-wallet", { reader: r })).toBeNull();
    expect(await readPancakePositions(97, `0x${"0".repeat(40)}`, { reader: r })).toBeNull();
    expect(await readPancakePositions(1, WALLET, { reader: r })).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it("remembers a failed read for a minute, then asks the chain again", async () => {
    let t = 0;
    let calls = 0;
    const failing: PositionReader = {
      balanceOf: async () => {
        calls++;
        throw new Error("rpc down");
      },
    };
    const now = () => t;
    expect(await readPancakePositions(97, WALLET, { reader: failing, now })).toBeNull();
    t = POSITIONS_FAILURE_TTL_MS - 1;
    expect(await readPancakePositions(97, WALLET, { reader: failing, now })).toBeNull();
    expect(calls).toBe(2);
    t = POSITIONS_FAILURE_TTL_MS;
    expect(await readPancakePositions(97, WALLET, { reader: reader(1, 0), now })).toMatchObject({ held: 1 });
  });

  it("shares one read between page loads that arrive together", async () => {
    const r = reader(2, 0);
    const [a, b] = await Promise.all([
      readPancakePositions(97, WALLET, { reader: r }),
      readPancakePositions(97, WALLET, { reader: r }),
    ]);
    expect(a).toEqual(b);
    expect(r.calls).toHaveLength(2);
  });
});
