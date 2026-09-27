import { describe, expect, it } from "vitest";
import {
  getTargetChainState,
  setTargetChainState,
  subscribeTargetChain,
} from "../apps/web/src/lib/target-chain";

describe("target chain store", () => {
  it("starts unknown instead of a compiled-in chain", () => {
    expect(getTargetChainState()).toBeNull();
  });

  it("notifies subscribers once the server states the chain", () => {
    let calls = 0;
    const unsubscribe = subscribeTargetChain(() => {
      calls += 1;
    });
    setTargetChainState(97, "sUSD");
    expect(getTargetChainState()).toEqual({ chainId: 97, settlementSymbol: "sUSD" });
    expect(calls).toBe(1);
    unsubscribe();
  });

  it("does not notify again for the same chain", () => {
    let calls = 0;
    const unsubscribe = subscribeTargetChain(() => {
      calls += 1;
    });
    setTargetChainState(97, "sUSD");
    expect(calls).toBe(0);
    unsubscribe();
  });

  it("ignores an invalid chain rather than clearing a known one", () => {
    setTargetChainState(97, "sUSD");
    setTargetChainState(0);
    setTargetChainState(Number.NaN);
    expect(getTargetChainState()?.chainId).toBe(97);
  });

  it("derives the symbol from the published table when none is passed", () => {
    setTargetChainState(56);
    expect(getTargetChainState()).toEqual({ chainId: 56, settlementSymbol: "$U" });
  });
});
