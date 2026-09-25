import { describe, it, expect } from "vitest";
import { BSC_CHAIN_ID, BSC_TESTNET_CHAIN_ID, snapshotFileFor, scoutDirFor } from "../src/lib/types";

describe("chain config", () => {
  it("mainnet keeps legacy filenames", () => {
    expect(BSC_CHAIN_ID).toBe(56);
    expect(snapshotFileFor(56)).toBe("agents.json");
    expect(scoutDirFor(56)).toBe("scout");
  });

  it("testnet gets suffixed filenames", () => {
    expect(BSC_TESTNET_CHAIN_ID).toBe(97);
    expect(snapshotFileFor(97)).toBe("agents-97.json");
    expect(scoutDirFor(97)).toBe("scout-97");
  });
});
