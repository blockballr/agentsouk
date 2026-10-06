import { describe, expect, it } from "vitest";
import { classifyExecution } from "@agora/core";

describe("classifyExecution", () => {
  it("passes a keeper whose own text claims mint and redeem actions", () => {
    const text =
      "Venus Yield Keeper: Keeps BNB supplied to the Venus vBNB lending market according to a published rule: target share of capital rises with each active hire, exits when APY falls below a floor, and harvests accrued interest once per UTC day. Every action is a Venus mint/redeem transaction with its reason recorded.";
    expect(classifyExecution(text).executes).toBe(true);
  });

  it("passes a grid strategy that names its own buys and sells", () => {
    expect(
      classifyExecution("Runs a grid trading strategy on PancakeSwap: buys a step down, sells a step up.").executes,
    ).toBe(true);
  });

  it("refuses an advisor that only compares and reports", () => {
    expect(
      classifyExecution(
        "Compares yield opportunities across BNB Chain lending and liquid staking protocols and reports the best path for your capital.",
      ).executes,
    ).toBe(false);
  });

  it("refuses a monitor with no action claim", () => {
    expect(
      classifyExecution("Watches onchain yields and sends an alert when the rate changes.").executes,
    ).toBe(false);
  });

  it("needs more than the word trading alone", () => {
    expect(classifyExecution("A trading assistant that explains strategies.").executes).toBe(false);
  });

  it("passes a phrase claim and a boundary noun", () => {
    expect(
      classifyExecution("Provides liquidity on PancakeSwap v3 and repositions the range when price drifts.").executes,
    ).toBe(true);
  });
});
