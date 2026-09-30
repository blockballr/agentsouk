// the PancakeSwap tag comes from a description that says so, or from an agent we run
// that reads PancakeSwap on chain even though its registration text predates that
import { describe, expect, it } from "vitest";
import { isPancakeSwapAgent, readsPancakeSwap } from "../src/lib/pancakeswap";

describe("PancakeSwap readers", () => {
  it("marks only the grid agent we run on testnet as a reader", () => {
    expect(readsPancakeSwap(97, "2522")).toBe(true);
    expect(readsPancakeSwap(97, "2521")).toBe(false);
    expect(readsPancakeSwap(56, "2522")).toBe(false);
  });

  it("leaves the text claim to the description alone", () => {
    expect(isPancakeSwapAgent("Souk Grid Planner", "Plans a grid trading ladder from a price range")).toBe(false);
    expect(isPancakeSwapAgent("Range bot", "Manages PancakeSwap v3 concentrated liquidity ranges")).toBe(true);
  });
});
