// The addresses below are the ones a reviewer checks; pinning them means a chain-97 deployment
// cannot quietly publish the mainnet registry.
import { describe, expect, it } from "vitest";
import {
  chainLabel,
  explorerAddressUrl,
  REGISTRY_BY_CHAIN,
  registryFor,
  SETTLEMENT_ASSET_BY_CHAIN,
  settlementAssetFor,
} from "../apps/web/src/lib/contracts";

describe("published contract addresses", () => {
  it("publishes the chain-97 registry the agents are actually registered in", () => {
    expect(registryFor(97)).toBe("0x8004a818bfb912233c491871b3d84c89a494bd9e");
  });

  it("keeps the mainnet registry distinct from the testnet one", () => {
    expect(registryFor(56)).toBe("0x8004a169fb4a3325136eb29fa0ceb6d2e539a432");
    expect(registryFor(56)).not.toBe(registryFor(97));
  });

  it("publishes the settlement asset for each chain", () => {
    expect(settlementAssetFor(97)).toEqual({
      symbol: "sUSD",
      address: "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53",
    });
    expect(settlementAssetFor(56)?.symbol).toBe("$U");
  });

  it("returns null for a chain we do not settle on, rather than guessing", () => {
    expect(registryFor(1)).toBeNull();
    expect(settlementAssetFor(1)).toBeNull();
  });

  it("points at the explorer for the chain in question", () => {
    expect(explorerAddressUrl(97, "0xabc")).toBe("https://testnet.bscscan.com/address/0xabc");
    expect(explorerAddressUrl(56, "0xabc")).toBe("https://bscscan.com/address/0xabc");
  });

  it("names the chain for display, because the brief grades stating it", () => {
    expect(chainLabel(97)).toBe("BSC testnet");
    expect(chainLabel(56)).toBe("BNB Smart Chain");
  });

  it("does not name mainnet while serving the testnet chain", () => {
    // the homepage evidence strip hardcoded "BNB Smart Chain (56)" on a chain-97
    // deployment, in the largest type on the page
    expect(chainLabel(97)).not.toMatch(/56/);
    expect(chainLabel(97)).not.toMatch(/Smart Chain$/);
  });

  it("keeps every published address a full 20-byte hex string", () => {
    const all = [
      ...Object.values(REGISTRY_BY_CHAIN),
      ...Object.values(SETTLEMENT_ASSET_BY_CHAIN).map((a) => a.address),
    ];
    for (const address of all) {
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
