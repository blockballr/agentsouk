import { describe, expect, it, afterEach } from "vitest";
import { parseEther, decodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tradeIntent, tradeTokenIn, type HireView } from "@/lib/vault";
import { resolveActor } from "@/lib/vault-actor";

const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd";

function hireView(over: Partial<HireView>): HireView {
  return {
    id: 1n,
    buyer: "0x0000000000000000000000000000000000000001",
    agent: "0x0000000000000000000000000000000000000002",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    maxSlippageBps: 500,
    open: true,
    balanceA: parseEther("0.01"),
    balanceB: 0n,
    refPriceX96: 1n,
    fee: 500,
    ...over,
  };
}

describe("the trade policy", () => {
  it("wants the side that holds a balance, and skips the rest", () => {
    expect(tradeTokenIn(hireView({}))).toBe("A");
    expect(tradeTokenIn(hireView({ balanceA: 0n, balanceB: parseEther("1") }))).toBe("B");
    expect(tradeTokenIn(hireView({ balanceA: 0n, balanceB: 0n }))).toBe(null);
    expect(tradeTokenIn(hireView({ open: false }))).toBe(null);
    expect(tradeTokenIn(hireView({ expiry: Math.floor(Date.now() / 1000) - 1 }))).toBe(null);
  });

  it("swaps one side fully, floor owned by the contract", () => {
    const intent = tradeIntent(hireView({}), WBNB, USDT);
    expect(intent?.tokenIn).toBe(WBNB);
    expect(intent?.amountIn).toBe(parseEther("0.01"));
    expect(intent?.minOut).toBe(0n);
    const decoded = decodeFunctionData({
      abi: [
        { name: "trade", type: "function", stateMutability: "nonpayable", inputs: [
          { name: "id", type: "uint256" }, { name: "tokenIn", type: "address" },
          { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }], outputs: [{ type: "uint256" }] },
      ] as const,
      data: intent!.calldata,
    });
    expect(decoded.args[0]).toBe(1n);
    expect(decoded.args[1]).toBe(WBNB);
    expect(decoded.args[2]).toBe(parseEther("0.01"));
    expect(decoded.args[3]).toBe(0n);
  });
});

describe("the custody fork", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("raw key resolves from its own env and reports the matching kind", () => {
    process.env.AGENT_EXECUTOR_KEY = generatePrivateKey();
    const actor = resolveActor("rawkey");
    expect(actor.kind).toBe("rawkey");
  });

  it("fails closed when a half is chosen without its config", () => {
    delete process.env.AGENT_EXECUTOR_KEY;
    expect(() => resolveActor("rawkey")).toThrow(/AGENT_EXECUTOR_KEY/);
    delete process.env.AGENT_ALTANA_SESSION;
    delete process.env.AGENT_ALTANA_SESSION_KEY;
    expect(() => resolveActor("altana")).toThrow(/AGENT_ALTANA_SESSION/);
    expect(() => resolveActor("both")).toThrow(/rawkey or altana/);
  });
});
