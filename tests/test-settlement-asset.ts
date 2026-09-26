import { describe, expect, it } from "vitest";
import { settlementAsset, targetChainId, BSC_CHAIN_ID, BSC_TESTNET_CHAIN_ID } from "../src/lib/types";

// The requirements route advertises this asset and the relay broadcasts against it; if they
// disagree the client signs a domain the token rejects, so the mapping is pinned here.
describe("settlementAsset", () => {
  it("settles chain 97 in the sUSD we deployed for the campaign", () => {
    const asset = settlementAsset(BSC_TESTNET_CHAIN_ID);
    expect(asset.address).toBe("0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53");
    expect(asset.symbol).toBe("sUSD");
    expect(asset.decimals).toBe(18);
    // this exact name is the EIP-712 domain string wallets show the signer, so
    // it must say the asset is a test asset
    expect(asset.eip712Name).toBe("Agent Souk Test USD");
    expect(asset.eip712Version).toBe("1");
  });

  it("settles chain 56 in $U, which is proven on mainnet", () => {
    const asset = settlementAsset(BSC_CHAIN_ID);
    expect(asset.address).toBe("0xcE24439F2D9C6a2289F741120FE202248B666666");
    expect(asset.symbol).toBe("U");
    expect(asset.eip712Name).toBe("United Stables");
    expect(asset.eip712Version).toBe("1");
  });

  it("refuses a chain with no configured asset rather than defaulting", () => {
    expect(() => settlementAsset(1)).toThrow(/No settlement asset/);
    expect(() => settlementAsset(8453)).toThrow(/No settlement asset/);
  });

  it("follows TARGET_CHAIN when no chain is passed", () => {
    const before = process.env.TARGET_CHAIN;
    try {
      process.env.TARGET_CHAIN = "97";
      expect(targetChainId()).toBe(97);
      expect(settlementAsset().address).toBe("0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53");

      process.env.TARGET_CHAIN = "56";
      expect(targetChainId()).toBe(56);
      expect(settlementAsset().address).toBe("0xcE24439F2D9C6a2289F741120FE202248B666666");
    } finally {
      if (before === undefined) delete process.env.TARGET_CHAIN;
      else process.env.TARGET_CHAIN = before;
    }
  });
});
