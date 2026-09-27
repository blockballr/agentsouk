// Pins the build route's chain decision. The route writes the snapshot the
// reader loads for the deployment's target chain, and it must read that same
// chain from the registry. The resolver is the one pure decision behind both,
// so these tests need no registry and no filesystem; scanner carries the
// server-only marker, so stub it out before importing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveIndexBuildTarget } from "../src/lib/scanner";
import { BSC_CHAIN_ID, BSC_TESTNET_CHAIN_ID } from "../src/lib/types";

const ORIGINAL_TARGET = process.env.TARGET_CHAIN;

beforeEach(() => {
  delete process.env.TARGET_CHAIN;
});

afterEach(() => {
  if (ORIGINAL_TARGET === undefined) delete process.env.TARGET_CHAIN;
  else process.env.TARGET_CHAIN = ORIGINAL_TARGET;
});

describe("index build target chain", () => {
  it("resolves the mainnet snapshot filename and chain 56", () => {
    const target = resolveIndexBuildTarget(BSC_CHAIN_ID);
    expect(target.chainId).toBe(56);
    expect(target.snapshotFile).toBe("agents.json");
  });

  it("resolves the testnet snapshot filename and chain 97", () => {
    const target = resolveIndexBuildTarget(BSC_TESTNET_CHAIN_ID);
    expect(target.chainId).toBe(97);
    expect(target.snapshotFile).toBe("agents-97.json");
  });

  it("parses the chain the route reads from the query string", () => {
    expect(resolveIndexBuildTarget("97")).toEqual({
      chainId: BSC_TESTNET_CHAIN_ID,
      snapshotFile: "agents-97.json",
    });
    expect(resolveIndexBuildTarget("56")).toEqual({
      chainId: BSC_CHAIN_ID,
      snapshotFile: "agents.json",
    });
  });

  // The audit: the route fetched the default chain (56) no matter what target
  // the deployment served. With no chain requested the fallback must be the
  // target chain, never the hardcoded 56 constant.
  it("fetches the target chain rather than the 56 constant when none is requested", () => {
    process.env.TARGET_CHAIN = "97";
    const target = resolveIndexBuildTarget();
    expect(target.chainId).toBe(BSC_TESTNET_CHAIN_ID);
    expect(target.chainId).not.toBe(BSC_CHAIN_ID);
    expect(target.snapshotFile).toBe("agents-97.json");
  });

  it("still resolves chain 56 when the target itself is 56", () => {
    process.env.TARGET_CHAIN = "56";
    const target = resolveIndexBuildTarget();
    expect(target.chainId).toBe(BSC_CHAIN_ID);
    expect(target.snapshotFile).toBe("agents.json");
  });

  it("defaults to mainnet only when the deployment target is unset", () => {
    const target = resolveIndexBuildTarget();
    expect(target.chainId).toBe(BSC_CHAIN_ID);
    expect(target.snapshotFile).toBe("agents.json");
  });

  it("prefers an explicit chain over the deployment target", () => {
    process.env.TARGET_CHAIN = "56";
    expect(resolveIndexBuildTarget("97").chainId).toBe(BSC_TESTNET_CHAIN_ID);
    process.env.TARGET_CHAIN = "97";
    expect(resolveIndexBuildTarget("56").chainId).toBe(BSC_CHAIN_ID);
  });

  it("ignores an empty or invalid chain and keeps the target", () => {
    process.env.TARGET_CHAIN = "97";
    for (const bad of ["", "   ", "abc", "0", "-1", null, undefined]) {
      const target = resolveIndexBuildTarget(bad);
      expect(target.chainId).toBe(BSC_TESTNET_CHAIN_ID);
      expect(target.snapshotFile).toBe("agents-97.json");
    }
  });
});
