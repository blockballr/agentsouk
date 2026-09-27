// The mint path is a transaction users send, so its encoding is pinned rather than trusted to
// a library call: a wrong selector silently calls a nonexistent function and surfaces as an opaque revert.
import { describe, expect, it, vi } from "vitest";
import { parseUnits } from "viem";

// the mint route reaches server-only stores through its own module graph, and
// this test only wants the pure drip decision it exports
vi.mock("server-only", () => ({}));

import {
  canAffordHire,
  encodeBalanceOf,
  encodeMint,
  explainMintFailure,
  isTestnet,
  MINT_PER_CLICK,
  SUSD_ADDRESS,
} from "../apps/web/src/lib/mint";
import { GAS_FLOOR_WEI, gasDripFor } from "../src/app/api/tokens/mint/route";

const BUYER = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713" as const;

describe("test token mint", () => {
  it("uses the mint(address,uint256) selector", () => {
    expect(encodeMint(BUYER, parseUnits("10", 18)).slice(0, 10)).toBe("0x40c10f19");
  });

  it("pads the recipient to a full word", () => {
    const data = encodeMint(BUYER, parseUnits("10", 18));
    expect(data.slice(10, 74)).toBe("000000000000000000000000" + BUYER.slice(2).toLowerCase());
  });

  it("encodes 10 sUSD as 10^19 wei for an 18 decimal token", () => {
    expect(MINT_PER_CLICK).toBe(10_000_000_000_000_000_000n);
    expect(encodeMint(BUYER, MINT_PER_CLICK)).toContain("8ac7230489e80000");
  });

  it("encodes balanceOf with the standard 0x70a08231 selector", () => {
    expect(encodeBalanceOf(BUYER).slice(0, 10)).toBe("0x70a08231");
  });

  it("is reachable on testnet only, so it cannot appear on a mainnet deployment", () => {
    expect(isTestnet(97)).toBe(true);
    expect(isTestnet(56)).toBe(false);
  });

  it("pins the settlement token address", () => {
    expect(SUSD_ADDRESS).toBe("0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53");
  });

  it("reports a user rejection as a rejection rather than a failure", () => {
    expect(explainMintFailure(4001, "")).toMatch(/rejected/i);
    expect(explainMintFailure(undefined, "User rejected the request")).toMatch(/rejected/i);
  });

  it("names an unrecognised code instead of guessing at it", () => {
    const text = explainMintFailure(-32603, "execution reverted");
    expect(text).toContain("-32603");
    expect(text).toContain("execution reverted");
  });

  it("surfaces insufficient gas money as such", () => {
    expect(explainMintFailure(undefined, "insufficient funds for gas")).toMatch(/BNB/i);
  });

  it("knows whether a balance covers one hire", () => {
    const price = parseUnits("2", 18);
    expect(canAffordHire(parseUnits("2", 18), price)).toBe(true);
    expect(canAffordHire(parseUnits("1.99", 18), price)).toBe(false);
  });
});

describe("sponsored gas drip", () => {
  it("tops a wallet holding dust up by the shortfall", () => {
    // 0.00000000000001 tBNB: the dust an earlier faucet claim can leave behind
    const dust = 10_000n;
    const drip = gasDripFor(dust);
    expect(drip.outcome).toBe("topped_up");
    expect(drip.amountWei).toBe(GAS_FLOOR_WEI - dust);
    expect(drip.amountWei).toBeGreaterThan(0n);
  });

  it("leaves a wallet at or above the floor alone and says it is already funded", () => {
    for (const balance of [GAS_FLOOR_WEI, GAS_FLOOR_WEI * 3n]) {
      const drip = gasDripFor(balance);
      expect(drip.amountWei).toBe(0n);
      expect(drip.outcome).toBe("already_funded");
      expect(drip.message).toMatch(/already holds/i);
    }
  });

  it("never debits the relay more than the shortfall to the floor", () => {
    for (const balance of [0n, 1n, GAS_FLOOR_WEI / 2n, GAS_FLOOR_WEI - 1n]) {
      const drip = gasDripFor(balance);
      expect(drip.amountWei).toBe(GAS_FLOOR_WEI - balance);
      expect(drip.amountWei + balance).toBe(GAS_FLOOR_WEI);
    }
    expect(gasDripFor(GAS_FLOOR_WEI + 1n).amountWei).toBe(0n);
  });

  it("names the floor as one registration's gas, not an arbitrary zero", () => {
    expect(GAS_FLOOR_WEI).toBe(parseUnits("0.001", 18));
  });
});
